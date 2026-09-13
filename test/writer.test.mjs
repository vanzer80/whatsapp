import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { AccessStore, savePolicy } from '../src/access.mjs';
import { Writer } from '../src/writer.mjs';
import { ACCOUNT, GROUP, PRIVATE, fixtures } from './fixtures.mjs';

const ALL_SCOPES=['whatsapp.read','whatsapp.send','whatsapp.group.create','whatsapp.group.manage'];
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function setup(t,{scopes=ALL_SCOPES,ids=[GROUP]}={}){
  const directory=mkdtempSync(path.join(tmpdir(),'wa-writer-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const file=path.join(directory,'access.json');
  if(scopes===null)savePolicy(ACCOUNT,ids,file);
  else savePolicy(ACCOUNT,ids,file,scopes);
  const access=new AccessStore(file),provider=fixtures();
  const audit=[];
  const writer=new Writer(provider,{access,audit:event=>audit.push(event)});
  return {file,access,provider,writer,audit};
}

test('política legada v1 continua somente leitura e não ganha escrita implicitamente',async t=>{
  const {writer}=setup(t,{scopes:null});
  await assert.rejects(()=>writer.execute('send_message',{chat_id:GROUP,text:'teste',idempotency_key:'legacy-0001'}),{code:'WRITE_SCOPE_REQUIRED'});
});
test('envio exige conversa autorizada e registra auditoria sem corpo',async t=>{
  const {writer,provider,audit}=setup(t);
  const result=await writer.execute('send_message',{chat_id:GROUP,text:'mensagem simulada',idempotency_key:'send-0001'});
  assert.equal(result.ok,true);
  assert.equal(provider.calls.filter(c=>Array.isArray(c)&&c[0]==='sendMessage').length,1);
  assert.equal(audit.length,1);
  assert.equal(JSON.stringify(audit).includes('mensagem simulada'),false);
  await assert.rejects(()=>writer.execute('send_message',{chat_id:PRIVATE,text:'fora',idempotency_key:'send-0002'}),{code:'CHAT_NOT_ALLOWED'});
});

test('envio idempotente repete resultado sem duplicar envio e conflito de chave é bloqueado',async t=>{
  const {writer,provider}=setup(t);
  const args={chat_id:GROUP,text:'uma vez',idempotency_key:'send-idem-0001'};
  const first=await writer.execute('send_message',args);
  const second=await writer.execute('send_message',args);
  assert.deepEqual(second,first);
  assert.equal(provider.calls.filter(c=>Array.isArray(c)&&c[0]==='sendMessage').length,1);
  await assert.rejects(()=>writer.execute('send_message',{...args,text:'outro texto'}),{code:'IDEMPOTENCY_CONFLICT'});
});

test('criação de grupo é idempotente e exige scope específico',async t=>{
  const {writer,provider}=setup(t);
  const args={name:'Grupo de teste',participant_ids:[PRIVATE],idempotency_key:'group-idem-0001'};
  const first=await writer.execute('create_group',args);
  const second=await writer.execute('create_group',args);
  assert.deepEqual(second,first);
  assert.equal(first.group_id,'120000000099@g.us');
  assert.equal(provider.calls.filter(c=>Array.isArray(c)&&c[0]==='createGroup').length,1);
  const denied=setup(t,{scopes:['whatsapp.read','whatsapp.send']});
  await assert.rejects(()=>denied.writer.execute('create_group',{...args,idempotency_key:'group-denied-1'}),{code:'WRITE_SCOPE_REQUIRED'});
});

test('gestão de grupo chama apenas operação autorizada no grupo permitido',async t=>{
  const {writer,provider}=setup(t);
  await writer.execute('update_group',{chat_id:GROUP,subject:'Novo nome',messages_admins_only:false});
  await writer.execute('manage_group_participants',{chat_id:GROUP,action:'add',participant_ids:[PRIVATE]});
  assert.equal(provider.calls.filter(c=>Array.isArray(c)&&c[0]==='updateGroup').length,1);
  assert.equal(provider.calls.filter(c=>Array.isArray(c)&&c[0]==='manageGroupParticipants').length,1);
  await assert.rejects(()=>writer.execute('update_group',{chat_id:'120000000777@g.us',subject:'x'}),{code:'CHAT_NOT_ALLOWED'});
});

test('revogação durante mutação descarta sucesso e bloqueia próxima operação na fila',async t=>{
  const {file,writer,provider}=setup(t);
  const entered=deferred(),release=deferred();
  provider.sendMessage=async(id,text)=>{provider.calls.push(['sendMessage',id,text]);entered.resolve();await release.promise;return {id:{_serialized:'late-send'}};};
  const first=writer.execute('send_message',{chat_id:GROUP,text:'primeira',idempotency_key:'queue-0001'});
  const second=writer.execute('send_message',{chat_id:GROUP,text:'segunda',idempotency_key:'queue-0002'});
  await entered.promise;
  savePolicy(ACCOUNT,[GROUP],file,['whatsapp.read']);
  release.resolve();
  await assert.rejects(()=>first,{code:'ACCESS_REVOKED'});
  await assert.rejects(()=>second,{code:'ACCESS_REVOKED'});
  assert.equal(provider.calls.filter(c=>Array.isArray(c)&&c[0]==='sendMessage').length,1);
});

test('scope de gestão não autoriza envio e entradas inválidas são rejeitadas antes do provedor',async t=>{
  const {writer,provider}=setup(t,{scopes:['whatsapp.read','whatsapp.group.manage']});
  await assert.rejects(()=>writer.execute('send_message',{chat_id:GROUP,text:'não',idempotency_key:'scope-0001'}),{code:'WRITE_SCOPE_REQUIRED'});
  await assert.rejects(()=>writer.execute('manage_group_participants',{chat_id:GROUP,action:'add',participant_ids:[PRIVATE,PRIVATE]}),{code:'INVALID_WRITE_ARGUMENTS'});
  assert.equal(provider.calls.some(c=>Array.isArray(c)&&['sendMessage','manageGroupParticipants'].includes(c[0])),false);
});
