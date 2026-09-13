import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { dataDirectory, readPrivateJson, writePrivateJson } from './local-security.mjs';

export const validChatId = value => typeof value === 'string' && /^\d+(?:-\d+)?@(?:c\.us|g\.us|lid)$/.test(value) && value.length <= 80;
const validAccount = value => typeof value === 'string' && /^\d+@(?:c\.us|lid)$/.test(value) && value.length <= 80;
export const ACCESS_SCOPES = Object.freeze(['whatsapp.read','whatsapp.send','whatsapp.group.create','whatsapp.group.manage']);
export const permissionPath = () => path.join(dataDirectory(), 'access.json');

function commonValid(value) {
  return validAccount(value.account_id) && typeof value.revision === 'string' && /^[a-f0-9-]{36}$/.test(value.revision) &&
    Array.isArray(value.allowed_chat_ids) && value.allowed_chat_ids.length <= 30 && value.allowed_chat_ids.every(validChatId) &&
    new Set(value.allowed_chat_ids).size === value.allowed_chat_ids.length;
}
export function validatePolicy(value) {
  if (!value || typeof value !== 'object') throw new Error('Permissões inválidas. Selecione novamente as conversas no computador.');
  const keys = Object.keys(value).sort().join(',');
  if (value.version === 1 && keys === 'account_id,allowed_chat_ids,revision,version' && commonValid(value)) return value;
  const scopesValid = Array.isArray(value.scopes) && value.scopes.length >= 1 && value.scopes.length <= ACCESS_SCOPES.length &&
    value.scopes.every(scope => ACCESS_SCOPES.includes(scope)) && new Set(value.scopes).size === value.scopes.length && value.scopes.includes('whatsapp.read');
  if (value.version === 2 && keys === 'account_id,allowed_chat_ids,revision,scopes,version' && commonValid(value) && scopesValid) return value;
  throw new Error('Permissões inválidas. Selecione novamente as conversas no computador.');
}
export function savePolicy(accountId, ids, file = permissionPath(), scopes = null) {
  const policy = scopes == null
    ? { version: 1, account_id: accountId, allowed_chat_ids: ids, revision: randomUUID() }
    : { version: 2, account_id: accountId, allowed_chat_ids: ids, scopes, revision: randomUUID() };
  const validated = validatePolicy(policy);
  writePrivateJson(file, validated);
  return validated;
}
export class AccessStore {
  constructor(file = permissionPath()) { this.file = file; }
  load() {
    try { return validatePolicy(readPrivateJson(this.file)); }
    catch { return null; }
  }
  snapshot(accountId) {
    const policy = this.load();
    if (!policy || policy.account_id !== accountId || !policy.allowed_chat_ids.length) return null;
    return policy;
  }
  unchanged(snapshot, accountId) {
    const current = this.snapshot(accountId);
    return Boolean(current && snapshot && current.revision === snapshot.revision && JSON.stringify(current) === JSON.stringify(snapshot));
  }
}
