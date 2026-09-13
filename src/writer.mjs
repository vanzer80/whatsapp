import path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ReadError } from './core.mjs';
import { AccessStore, validChatId } from './access.mjs';
import { dataDirectory } from './local-security.mjs';
import { PersistentAuditLog, PersistentIdempotencyStore, PersistentWriteRateLimiter,
  persistentKey, requestFingerprint } from './write-hardening.mjs';

export const WRITE_SCOPES = Object.freeze({
  send: 'whatsapp.send',
  groupCreate: 'whatsapp.group.create',
  groupManage: 'whatsapp.group.manage'
});
const groupId = z.string().max(80).regex(/^\d+(?:-\d+)?@g\.us$/);
const participantId = z.string().max(80).regex(/^\d+@(?:c\.us|lid)$/);
const idempotencyKey = z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/);

export const writeSchemas = {
  send_message: z.object({ chat_id: z.string().refine(validChatId), text: z.string().min(1).max(4096), idempotency_key: idempotencyKey }).strict(),
  create_group: z.object({ name: z.string().trim().min(1).max(100), participant_ids: z.array(participantId).min(1).max(30), idempotency_key: idempotencyKey }).strict(),
  update_group: z.object({ chat_id: groupId, subject: z.string().trim().min(1).max(100).optional(), description: z.string().max(512).optional(), messages_admins_only: z.boolean().optional(), info_admins_only: z.boolean().optional(), idempotency_key: idempotencyKey }).strict()
    .refine(v => v.subject !== undefined || v.description !== undefined || v.messages_admins_only !== undefined || v.info_admins_only !== undefined),
  manage_group_participants: z.object({ chat_id: groupId, action: z.enum(['add','remove','promote','demote']), participant_ids: z.array(participantId).min(1).max(30), idempotency_key: idempotencyKey }).strict()
};
export const writeDescriptions = {
  send_message: 'Envia uma mensagem para uma conversa previamente autorizada. Requer chave de idempotência.',
  create_group: 'Cria um grupo com participantes informados. Requer permissão local específica e chave de idempotência.',
  update_group: 'Altera assunto, descrição ou permissões de um grupo autorizado. Requer chave de idempotência.',
  manage_group_participants: 'Adiciona, remove, promove ou rebaixa participantes de um grupo autorizado. Requer chave de idempotência.'
};
const requiredScope = name => name === 'send_message' ? WRITE_SCOPES.send : name === 'create_group' ? WRITE_SCOPES.groupCreate : WRITE_SCOPES.groupManage;
const publicMessageId = value => createHash('sha256').update(String(value ?? '')).digest('hex').slice(0,24);

export class Writer {
  constructor(provider, { access = new AccessStore(), idempotencyTtlMs = 24 * 60 * 60 * 1000, audit = () => {},
    rateLimits, auditMaxBytes, auditKeep, stateDirectory = access?.file ? path.dirname(access.file) : dataDirectory(),
    idempotencyStore = null, rateLimiter = null, auditLog = null } = {}) {
    this.provider = provider;
    this.access = access;
    this.idempotencyTtlMs = idempotencyTtlMs;
    this.audit = audit;
    this.tail = Promise.resolve();
    this.inflight = new Map();
    this.idempotency = idempotencyStore ?? new PersistentIdempotencyStore(path.join(stateDirectory, 'write-idempotency.json'));
    this.rateLimiter = rateLimiter ?? new PersistentWriteRateLimiter(path.join(stateDirectory, 'write-rate.json'), { limits: rateLimits });
    this.auditLog = auditLog ?? new PersistentAuditLog(path.join(stateDirectory, 'write-audit.jsonl'), { maxBytes: auditMaxBytes, keep: auditKeep });
  }
  policy(scope) {
    if (!this.provider.status().connected) throw new ReadError('NOT_CONNECTED', 'Abra o aplicativo WhatsApp Manutenção e conecte seu WhatsApp.');
    const policy = this.access.snapshot(this.provider.accountId());
    if (!policy) throw new ReadError('ACCESS_NOT_CONFIGURED', 'Nenhuma conversa autorizada para esta conta.');
    if (!policy.scopes?.includes(scope)) throw new ReadError('WRITE_SCOPE_REQUIRED', 'Esta operação de escrita não foi autorizada localmente.');
    return policy;
  }
  assertCurrent(policy) {
    if (!this.access.unchanged(policy, this.provider.accountId())) throw new ReadError('ACCESS_REVOKED', 'A autorização local mudou. A operação foi bloqueada.');
  }
  enqueue(task) {
    const run = this.tail.then(task, task);
    this.tail = run.catch(() => {});
    return run;
  }
  auditAttempt(name, args) {
    this.auditLog.record({ operation: name, phase: 'attempt', chat_id: args.chat_id ?? null, participant_count: args.participant_ids?.length ?? 0 });
  }
  auditResult(name, args, success, code) {
    const targetKind = args.chat_id ? (String(args.chat_id).endsWith('@g.us') ? 'group' : 'chat') : 'none';
    const persisted = { operation: name, phase: 'result', chat_id: args.chat_id ?? null,
      participant_count: args.participant_ids?.length ?? 0, success, ...(code ? { code } : {}) };
    this.auditLog.record(persisted);
    const safeEvent = { operation: name, phase: 'result', target_kind: targetKind, participant_count: persisted.participant_count, success, ...(code ? { code } : {}) };
    try { this.audit(safeEvent); } catch {}
  }
  async execute(name, input = {}) {
    if (!Object.hasOwn(writeSchemas, name)) throw new ReadError('UNKNOWN_TOOL', 'Operação de escrita indisponível.');
    const parsed = writeSchemas[name].safeParse(input);
    if (!parsed.success) throw new ReadError('INVALID_WRITE_ARGUMENTS', 'Confira os IDs, os limites e os campos da operação.');
    const args = parsed.data;
    if (args.participant_ids && new Set(args.participant_ids).size !== args.participant_ids.length)
      throw new ReadError('INVALID_WRITE_ARGUMENTS', 'Não repita participantes na mesma operação.');
    const policy = this.policy(requiredScope(name));
    if (args.chat_id && !policy.allowed_chat_ids.includes(args.chat_id)) throw new ReadError('CHAT_NOT_ALLOWED', 'Conversa fora da lista local de acesso.');
    return this.idempotent(name, args, policy);
  }
  idempotent(name, args, policy) {
    const accountId = this.provider.accountId();
    const key = persistentKey(accountId, args.idempotency_key);
    const fingerprint = requestFingerprint(name, args);
    const active = this.inflight.get(key);
    if (active) {
      if (active.fingerprint !== fingerprint) throw new ReadError('IDEMPOTENCY_CONFLICT', 'A chave de idempotência já foi usada com outros parâmetros.');
      return active.promise;
    }
    const stored = this.idempotency.lookup(key, fingerprint);
    if (stored) return Promise.resolve(stored);
    this.rateLimiter.consume(accountId, name);
    this.auditAttempt(name, args);
    const expiresAt = Date.now() + this.idempotencyTtlMs;
    const prior = this.idempotency.begin(key, fingerprint, expiresAt);
    if (prior) return Promise.resolve(prior);
    const context = { externalStarted: false };
    const promise = this.enqueue(async () => {
      try {
        this.assertCurrent(policy);
        const result = await this.run(name, args, context);
        this.assertCurrent(policy);
        this.idempotency.complete(key, fingerprint, result, expiresAt);
        this.auditResult(name, args, true);
        return result;
      } catch (error) {
        if (!context.externalStarted) this.idempotency.cancel(key, fingerprint);
        try { this.auditResult(name, args, false, error?.code ?? 'WRITE_FAILED'); } catch (auditError) {
          if (!(error instanceof ReadError)) throw auditError;
        }
        if (error instanceof ReadError) throw error;
        throw new ReadError('WRITE_FAILED', 'A operação de escrita não foi concluída pelo WhatsApp.');
      }
    });
    this.inflight.set(key, { fingerprint, promise });
    promise.finally(() => { if (this.inflight.get(key)?.promise === promise) this.inflight.delete(key); }).catch(() => {});
    return promise;
  }
  async run(name, args, context) {
    context.externalStarted = true;
    if (name === 'send_message') {
      const message = await this.provider.sendMessage(args.chat_id, args.text);
      return { ok: true, chat_id: args.chat_id, message_id: publicMessageId(message?.id?._serialized), idempotent: true };
    }
    if (name === 'create_group') {
      const created = await this.provider.createGroup(args.name, args.participant_ids);
      if (typeof created === 'string') throw new ReadError('WRITE_FAILED', 'O WhatsApp não conseguiu criar o grupo.');
      const group = created?.gid?._serialized;
      if (!group || !/^\d+(?:-\d+)?@g\.us$/.test(group)) throw new ReadError('WRITE_FAILED', 'O WhatsApp não confirmou o identificador do novo grupo.');
      return { ok: true, group_id: group, name: args.name, requested_participant_count: args.participant_ids.length, idempotent: true };
    }
    if (name === 'update_group') {
      await this.provider.updateGroup(args.chat_id, args);
      return { ok: true, chat_id: args.chat_id, idempotent: true };
    }
    await this.provider.manageGroupParticipants(args.chat_id, args.action, args.participant_ids);
    return { ok: true, chat_id: args.chat_id, action: args.action, participant_count: args.participant_ids.length, idempotent: true };
  }
}
