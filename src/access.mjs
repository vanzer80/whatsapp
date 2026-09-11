import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { dataDirectory, readPrivateJson, writePrivateJson } from './local-security.mjs';

export const validChatId = value => typeof value === 'string' && /^\d+(?:-\d+)?@(?:c\.us|g\.us|lid)$/.test(value) && value.length <= 80;
const validAccount = value => typeof value === 'string' && /^\d+@(?:c\.us|lid)$/.test(value) && value.length <= 80;
export const permissionPath = () => path.join(dataDirectory(), 'access.json');
export function validatePolicy(value) {
  if (!value || Object.keys(value).sort().join(',') !== 'account_id,allowed_chat_ids,revision,version' ||
      value.version !== 1 || !validAccount(value.account_id) ||
      typeof value.revision !== 'string' || !/^[a-f0-9-]{36}$/.test(value.revision) ||
      !Array.isArray(value.allowed_chat_ids) || value.allowed_chat_ids.length > 30 ||
      !value.allowed_chat_ids.every(validChatId) || new Set(value.allowed_chat_ids).size !== value.allowed_chat_ids.length)
    throw new Error('Permissões inválidas. Selecione novamente as conversas no computador.');
  return value;
}
export function savePolicy(accountId, ids, file = permissionPath()) {
  const policy = validatePolicy({ version: 1, account_id: accountId, allowed_chat_ids: ids, revision: randomUUID() });
  writePrivateJson(file, policy);
  return policy;
}
export class AccessStore {
  constructor(file = permissionPath()) { this.file = file; }
  load() {
    try { return validatePolicy(readPrivateJson(this.file)); }
    catch { return null; } // Missing, malformed, changed permissions or links all deny access.
  }
  snapshot(accountId) {
    const policy = this.load();
    if (!policy || policy.account_id !== accountId || !policy.allowed_chat_ids.length) return null;
    return policy;
  }
  unchanged(snapshot, accountId) {
    const current = this.snapshot(accountId);
    return Boolean(current && snapshot && current.revision === snapshot.revision &&
      JSON.stringify(current) === JSON.stringify(snapshot));
  }
}
