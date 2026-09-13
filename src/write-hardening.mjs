import { appendFileSync, chmodSync, existsSync, renameSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ReadError } from './core.mjs';
import { noLinks, readPrivateJson, secureDirectory, writePrivateJson } from './local-security.mjs';

const sha256 = value => createHash('sha256').update(String(value)).digest('hex');
const emptyState = () => ({ version: 1, entries: {} });
const validHex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

function loadState(file, validator, label) {
  if (!existsSync(file)) return emptyState();
  try {
    const state = readPrivateJson(file);
    if (!validator(state)) throw new Error('invalid shape');
    return state;
  } catch (error) {
    if (error?.code === 'ENOENT') return emptyState();
    throw new ReadError('WRITE_STATE_INVALID', `O estado local de ${label} está inválido.`);
  }
}

function saveState(file, state) {
  writePrivateJson(file, state);
}

export const persistentKey = (accountId, key) => sha256(`${accountId}\0${key}`);
export const requestFingerprint = (name, args) => sha256(JSON.stringify([name, args]));
function validIdempotencyState(state) {
  if (!state || state.version !== 1 || !state.entries || typeof state.entries !== 'object' || Array.isArray(state.entries)) return false;
  return Object.entries(state.entries).every(([key, entry]) => validHex(key) && entry && validHex(entry.fingerprint) &&
    Number.isFinite(entry.expires_at) && ['pending','complete'].includes(entry.status) &&
    (entry.status !== 'complete' || (entry.result && typeof entry.result === 'object' && !Array.isArray(entry.result))));
}

export class PersistentIdempotencyStore {
  constructor(file, { maxEntries = 64 } = {}) { this.file = file; this.maxEntries = maxEntries; }
  load(now = Date.now()) {
    const state = loadState(this.file, validIdempotencyState, 'idempotência');
    let changed = false;
    for (const [key, entry] of Object.entries(state.entries)) {
      if (entry.expires_at <= now) { delete state.entries[key]; changed = true; }
    }
    if (changed) saveState(this.file, state);
    return state;
  }
  lookup(key, fingerprint, now = Date.now()) {
    const entry = this.load(now).entries[key];
    if (!entry) return null;
    if (entry.fingerprint !== fingerprint) throw new ReadError('IDEMPOTENCY_CONFLICT', 'A chave de idempotência já foi usada com outros parâmetros.');
    if (entry.status === 'pending') throw new ReadError('IDEMPOTENCY_PENDING', 'Existe uma operação anterior com resultado indeterminado para esta chave.');
    return entry.result;
  }
  begin(key, fingerprint, expiresAt) {
    const state = this.load();
    const existing = state.entries[key];
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new ReadError('IDEMPOTENCY_CONFLICT', 'A chave de idempotência já foi usada com outros parâmetros.');
      if (existing.status === 'pending') throw new ReadError('IDEMPOTENCY_PENDING', 'Existe uma operação anterior com resultado indeterminado para esta chave.');
      return existing.result;
    }
    state.entries[key] = { fingerprint, status: 'pending', expires_at: expiresAt };
    this.trim(state);
    saveState(this.file, state);
    return null;
  }
  complete(key, fingerprint, result, expiresAt) {
    const state = this.load();
    const current = state.entries[key];
    if (!current || current.fingerprint !== fingerprint) throw new ReadError('WRITE_STATE_INVALID', 'O estado local de idempotência mudou durante a operação.');
    state.entries[key] = { fingerprint, status: 'complete', expires_at: expiresAt, result };
    this.trim(state);
    saveState(this.file, state);
  }
  cancel(key, fingerprint) {
    const state = this.load();
    if (state.entries[key]?.fingerprint === fingerprint) { delete state.entries[key]; saveState(this.file, state); }
  }
  trim(state) {
    const entries = Object.entries(state.entries);
    if (entries.length <= this.maxEntries) return;
    entries.sort((a,b) => b[1].expires_at - a[1].expires_at);
    state.entries = Object.fromEntries(entries.slice(0, this.maxEntries));
  }
}
function validRateState(state) {
  if (!state || state.version !== 1 || !state.entries || typeof state.entries !== 'object' || Array.isArray(state.entries)) return false;
  return Object.entries(state.entries).every(([key, entry]) => validHex(key) && entry &&
    Number.isInteger(entry.count) && entry.count >= 0 && Number.isFinite(entry.reset_at));
}

export const DEFAULT_WRITE_LIMITS = Object.freeze({
  send_message: Object.freeze({ limit: 12, windowMs: 60_000 }),
  create_group: Object.freeze({ limit: 3, windowMs: 10 * 60_000 }),
  update_group: Object.freeze({ limit: 6, windowMs: 60_000 }),
  manage_group_participants: Object.freeze({ limit: 6, windowMs: 60_000 })
});

export class PersistentWriteRateLimiter {
  constructor(file, { limits = DEFAULT_WRITE_LIMITS } = {}) { this.file = file; this.limits = limits; }
  consume(accountId, operation, now = Date.now()) {
    const policy = this.limits[operation];
    if (!policy) return;
    const state = loadState(this.file, validRateState, 'limite de escrita');
    const key = sha256(`${accountId}\0${operation}`);
    let entry = state.entries[key];
    if (!entry || entry.reset_at <= now) entry = { count: 0, reset_at: now + policy.windowMs };
    if (entry.count >= policy.limit) throw new ReadError('WRITE_RATE_LIMITED', 'Limite de operações de escrita atingido. Aguarde antes de tentar novamente.');
    entry.count += 1;
    state.entries[key] = entry;
    saveState(this.file, state);
  }
}
function safeAuditEvent(event) {
  return {
    timestamp: new Date().toISOString(),
    operation: event.operation,
    phase: event.phase,
    target_kind: event.chat_id ? (String(event.chat_id).endsWith('@g.us') ? 'group' : 'chat') : 'none',
    participant_count: Number.isInteger(event.participant_count) ? event.participant_count : 0,
    ...(event.success === undefined ? {} : { success: Boolean(event.success) }),
    ...(event.code ? { code: String(event.code).slice(0, 80) } : {})
  };
}

export class PersistentAuditLog {
  constructor(file, { maxBytes = 512 * 1024, keep = 5 } = {}) {
    this.file = file; this.maxBytes = maxBytes; this.keep = keep;
  }
  record(event) {
    try {
      secureDirectory(path.dirname(this.file));
      noLinks(this.file);
      const line = JSON.stringify(safeAuditEvent(event)) + '\n';
      if (existsSync(this.file) && statSync(this.file).size + Buffer.byteLength(line, 'utf8') > this.maxBytes) this.rotate();
      appendFileSync(this.file, line, { encoding: 'utf8', mode: 0o600 });
      if (process.platform !== 'win32') chmodSync(this.file, 0o600);
    } catch (error) {
      if (error instanceof ReadError) throw error;
      throw new ReadError('WRITE_AUDIT_UNAVAILABLE', 'Não foi possível registrar a auditoria local da operação.');
    }
  }
  rotate() {
    for (let index = this.keep - 1; index >= 1; index--) {
      const source = `${this.file}.${index}`, target = `${this.file}.${index + 1}`;
      if (existsSync(target)) unlinkSync(target);
      if (existsSync(source)) renameSync(source, target);
    }
    const first = `${this.file}.1`;
    if (existsSync(first)) unlinkSync(first);
    if (existsSync(this.file)) renameSync(this.file, first);
  }
}
