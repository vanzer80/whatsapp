import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from '../src/server.mjs';
import { Reader } from '../src/core.mjs';
import { Writer } from '../src/writer.mjs';
import { fixtures, fixtureAccess } from './fixtures.mjs';
const provider=fixtures();
if(process.argv.includes('--fail')) provider.chat=async()=>{throw new Error('SECRET_FIXTURE_DO_NOT_LEAK');};
const writeMode=process.argv.includes('--writer');
const scopes=writeMode?['whatsapp.read','whatsapp.send','whatsapp.group.create','whatsapp.group.manage']:null;
const access=fixtureAccess(undefined,scopes);
const reader=new Reader(provider,{access,cooldownMs:0});
const memoryEntries=new Map();
const idempotencyStore={
  lookup(key,fingerprint){const e=memoryEntries.get(key);if(!e)return null;if(e.fingerprint!==fingerprint)throw Object.assign(new Error('conflict'),{code:'IDEMPOTENCY_CONFLICT'});return e.status==='complete'?e.result:null;},
  begin(key,fingerprint,expiresAt){const e=memoryEntries.get(key);if(e)return e.status==='complete'?e.result:null;memoryEntries.set(key,{fingerprint,status:'pending',expiresAt});return null;},
  complete(key,fingerprint,result,expiresAt){memoryEntries.set(key,{fingerprint,status:'complete',result,expiresAt});},
  cancel(key,fingerprint){if(memoryEntries.get(key)?.fingerprint===fingerprint)memoryEntries.delete(key);}
};
const writer=writeMode?new Writer(provider,{access,idempotencyStore,rateLimiter:{consume(){}},auditLog:{record(){}}}):null;
const server=createMcpServer(reader,writer);
await server.connect(new StdioServerTransport());
