import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, lstatSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { AccessStore, savePolicy } from '../src/access.mjs';
import { Reader, MAX_RESPONSE_BYTES } from '../src/core.mjs';
import { minimalEnvironment, secureDirectory } from '../src/local-security.mjs';
import { fixtures, fixtureAccess, ACCOUNT, GROUP, PRIVATE } from './fixtures.mjs';

function sandbox(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'wa-security-test-'));
  t.after(() => rmSync(directory, {recursive:true,force:true}));
  const file = path.join(directory, 'access.json');
  return {directory,file,access:new AccessStore(file)};
}
function setup(t, ids=[GROUP]) {
  const local = sandbox(t); savePolicy(ACCOUNT,ids,local.file);
  const provider = fixtures();
  return {...local,provider,reader:new Reader(provider,{access:local.access,cooldownMs:0})};
}
test('sem arquivo de autorização nenhum metadado ou texto é lido', async t => {
  const {access} = sandbox(t), p=fixtures(), r=new Reader(p,{access});
  assert.equal((await r.execute('get_status')).access_enabled,false);
  for(const name of ['list_chats','read_messages','search_messages']) {
    const args=name==='read_messages'?{chat_id:GROUP}:name==='search_messages'?{chat_ids:[GROUP],query:'filtro'}:{};
    await assert.rejects(()=>r.execute(name,args),{code:'ACCESS_NOT_CONFIGURED'});
  }
  assert.deepEqual(p.calls,[]);
});
test('documento malformado, campo extra, curinga e outra conta bloqueiam sem consultar provedor', async t => {
  const {file,provider,reader}=setup(t);
  for(const content of ['{','null',JSON.stringify({version:1,account_id:ACCOUNT,allowed_chat_ids:['*'],revision:'00000000-0000-0000-0000-000000000001'}),
    JSON.stringify({...new AccessStore(file).load(), allow_all:true})]) {
    writeFileSync(file,content,{mode:0o600});
    await assert.rejects(()=>reader.execute('list_chats'),{code:'ACCESS_NOT_CONFIGURED'});
  }
  savePolicy('550000000099@c.us',[GROUP],file);
  await assert.rejects(()=>reader.execute('list_chats'),{code:'ACCESS_NOT_CONFIGURED'});
  assert.deepEqual(provider.calls,[]);
});
test('opção antiga allowedChatIds não substitui a autorização local', async t => {
  const {access}=sandbox(t),p=fixtures();
  const r=new Reader(p,{access,allowedChatIds:[GROUP]});
  await assert.rejects(()=>r.execute('read_messages',{chat_id:GROUP}),{code:'ACCESS_NOT_CONFIGURED'});
  assert.deepEqual(p.calls,[]);
});
test('a listagem consulta somente IDs autorizados, sem carregar a lista global', async t => {
  const {provider,reader}=setup(t);
  provider.chats=()=>{throw new Error('GLOBAL_CHAT_LIST_MUST_NOT_BE_CALLED');};
  const result=await reader.execute('list_chats');
  assert.deepEqual(result.chats.map(c=>c.chat_id),[GROUP]);
  assert.deepEqual(provider.calls,[['chat',GROUP]]);
  assert.doesNotMatch(JSON.stringify(result),/Fornecedor/);
});
test('revogar durante uma leitura descarta integralmente a resposta', async t => {
  const {file,provider,reader}=setup(t);
  let release,entered;
  const started=new Promise(resolve=>{entered=resolve;});
  provider.messages=()=>new Promise(resolve=>{release=resolve;entered();});
  const pending=reader.execute('read_messages',{chat_id:GROUP});
  await started;
  savePolicy(ACCOUNT,[],file);
  release(provider.sourceMessages);
  await assert.rejects(()=>pending,{code:'ACCESS_REVOKED'});
});
test('alterar a lista em execução passa a negar os IDs removidos', async t => {
  const {file,provider,reader}=setup(t,[GROUP,PRIVATE]);
  await reader.execute('read_messages',{chat_id:PRIVATE});
  savePolicy(ACCOUNT,[GROUP],file);provider.calls.length=0;
  await assert.rejects(()=>reader.execute('read_messages',{chat_id:PRIVATE}),{code:'CHAT_NOT_ALLOWED'});
  assert.deepEqual(provider.calls,[]);
});
test('troca de conta durante consulta impede devolução', async t => {
  const {provider,reader}=setup(t);
  provider.messages=async()=>{provider.accountId=()=> '550000000099@c.us';return provider.sourceMessages;};
  await assert.rejects(()=>reader.execute('read_messages',{chat_id:GROUP}),{code:'ACCESS_REVOKED'});
});
test('limite total inclui texto UTF-8, escape JSON e metadados', async () => {
  const p=fixtures();
  p.sourceMessages.splice(0,p.sourceMessages.length,...Array.from({length:200},(_,i)=>({
    id:{_serialized:`msg-${i}`},body:'\u0000😀'.repeat(3000),timestamp:1789128000+i,type:'chat',from:PRIVATE
  })));
  const r=new Reader(p,{access:fixtureAccess(),cooldownMs:0});
  const result=await r.execute('read_messages',{chat_id:GROUP,limit:50,scan_limit:200});
  assert.ok(Buffer.byteLength(JSON.stringify(result),'utf8')<=MAX_RESPONSE_BYTES);
  assert.ok(result.messages.length>0 && result.messages.length<50);
  assert.equal(result.result_truncated,true);
  assert.equal(result.matching_in_scanned_window,200);
});
test('autores e IDs de mensagens não expõem identificadores de telefone', async () => {
  const p=fixtures();p.sourceMessages[0].id._serialized=`false_${PRIVATE}_SECRET`;
  const r=new Reader(p,{access:fixtureAccess(),cooldownMs:0});
  const a=await r.execute('read_messages',{chat_id:GROUP});
  const b=await r.execute('read_messages',{chat_id:GROUP});
  assert.doesNotMatch(JSON.stringify(a),/550000000001|550000000009|_SECRET/);
  assert.equal(a.messages[0].author,b.messages[0].author);
  assert.equal(a.messages[2].author,'voce');
});
test('consultas concorrentes e rajadas são rejeitadas', async () => {
  const p=fixtures(), r=new Reader(p,{access:fixtureAccess(),cooldownMs:10000});
  let release,entered;const started=new Promise(resolve=>{entered=resolve;});
  p.messages=()=>new Promise(resolve=>{release=resolve;entered();});
  const pending=r.execute('read_messages',{chat_id:GROUP});await started;
  await assert.rejects(()=>r.execute('list_chats'),{code:'BUSY'});
  assert.equal((await r.execute('get_status')).access_enabled,true);
  release([]);await pending;
  await assert.rejects(()=>r.execute('list_chats'),{code:'RATE_LIMITED'});
});
test('credenciais e variáveis que alteram execução, proxy ou logs não são herdadas', () => {
  const result=minimalEnvironment({SystemRoot:'C:\\Windows',LOCALAPPDATA:'C:\\Users\\Test\\AppData\\Local',
    CONTROL_PLANE_API_KEY:'SECRET',OPENAI_API_KEY:'SECRET',AWS_SECRET_ACCESS_KEY:'SECRET',NODE_OPTIONS:'--import evil.mjs',
    NODE_PATH:'evil',PATH:'evil',LOG_HTTP_RAW_UNSAFE:'true',CONTROL_PLANE_BASE_URL:'https://evil.test',
    HTTPS_PROXY:'https://evil.test',WA_ALLOWED_CHAT_IDS:'*',WA_CHROME_PATH:'evil.exe',WA_TUNNEL_CLIENT:'evil.exe'});
  assert.deepEqual(Object.keys(result).sort(),['LOCALAPPDATA','SystemRoot']);
});
test('arquivo de permissão como link é recusado', {skip:process.platform==='win32'}, t => {
  const {directory,file}=sandbox(t);const target=path.join(directory,'other.json');
  savePolicy(ACCOUNT,[GROUP],target);symlinkSync(target,file);
  assert.equal(new AccessStore(file).snapshot(ACCOUNT),null);
});
test('pasta privada e arquivo POSIX têm permissões restritas; arquivo aberto a outros é recusado', {skip:process.platform==='win32'}, t => {
  const {directory,file,access}=setup(t);
  secureDirectory(directory);
  assert.equal(lstatSync(directory).mode&0o777,0o700);
  assert.equal(lstatSync(file).mode&0o777,0o600);
  chmodSync(file,0o644);assert.equal(access.snapshot(ACCOUNT),null);
});
