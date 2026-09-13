import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,readdirSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import {once} from 'node:events';
import {Readable,duplexPair} from 'node:stream';
import {randomBytes} from 'node:crypto';
import {parse} from 'smol-toml';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {registrationText,registerLocal,registrationStatus} from '../src/desktop-registration.mjs';
import {DesktopController,qrSvg} from '../src/desktop-controller.mjs';
import {startDesktopService,createWebHandler,PipeTransport} from '../src/desktop-service.mjs';
import {createMcpServer} from '../src/server.mjs';
import {AccessStore,savePolicy} from '../src/access.mjs';
import {ACCOUNT,GROUP,PRIVATE,LOCKED,fixtures} from './fixtures.mjs';

function sandbox(t){const directory=mkdtempSync(path.join(tmpdir(),'wad-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));return directory;}
const executable=path.resolve('App local com espaço','WhatsApp-Manutencao.exe');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};

test('registro preserva o texto e os valores de outras configurações do ChatGPT',()=>{
  const original='# Comentário mantido\r\nmodel = "modelo-local"\r\n[mcp_servers.outro]\r\ncommand = "outro"\r\nargs = ["a", "b"]\r\n[features]\r\ncustom = false\r\n';
  const next=registrationText(original,executable);
  assert.ok(next.startsWith(original));
  const parsed=parse(next);
  assert.deepEqual(parsed.mcp_servers['whatsapp_manutencao'],{command:executable,args:['--mcp'],enabled:true,startup_timeout_sec:45,tool_timeout_sec:90});
  delete parsed.mcp_servers['whatsapp_manutencao'];
  assert.deepEqual(parsed,parse(original));
});
test('registro cria cópia anterior, é idempotente e atualiza somente o próprio bloco',t=>{
  const directory=sandbox(t),file=path.join(directory,'config.toml');
  writeFileSync(file,'# manter\nmodel = "teste"\n');
  assert.equal(registerLocal(executable,file).backup_created,true);
  assert.equal(registrationStatus(executable,file),true);
  const first=readFileSync(file,'utf8');
  assert.equal(registerLocal(executable,file).backup_created,false);
  assert.equal(readFileSync(file,'utf8'),first);
  const backup=readdirSync(directory).find(n=>n.startsWith('config.antes-whatsapp-'));
  assert.equal(readFileSync(path.join(directory,backup),'utf8'),'# manter\nmodel = "teste"\n');
  const other=path.resolve('novo app','WhatsApp-Manutencao.exe');
  registerLocal(other,file);
  assert.equal(registrationStatus(other,file),true);
  assert.equal(parse(readFileSync(file,'utf8')).model,'teste');
});
test('configuração própria, TOML inválido e marcadores adulterados não são sobrescritos',t=>{
  const directory=sandbox(t),file=path.join(directory,'config.toml');
  for(const original of ['[mcp_servers.whatsapp_manutencao]\ncommand = "pessoal"\n','[mcp_servers."whatsapp-manutencao"]\ncommand = "pessoal"\n','model = [',' # BEGIN WHATSAPP-MANUTENCAO LOCAL\n# END WHATSAPP-MANUTENCAO LOCAL\n',
    'description = """\n# BEGIN WHATSAPP-MANUTENCAO LOCAL\ntexto do usuário\n# END WHATSAPP-MANUTENCAO LOCAL\n"""\n']){
    writeFileSync(file,original);assert.throws(()=>registerLocal(executable,file));assert.equal(readFileSync(file,'utf8'),original);
  }
  assert.throws(()=>registrationText('','relative.exe'));
});
test('registro recusa config.toml que aponta para outro arquivo',{skip:process.platform==='win32'},t=>{
  const directory=sandbox(t),target=path.join(directory,'real.toml'),link=path.join(directory,'config.toml');
  writeFileSync(target,'model = "teste"\n');symlinkSync(target,link);
  assert.throws(()=>registerLocal(executable,link));assert.equal(readFileSync(target,'utf8'),'model = "teste"\n');
});

function controller(t){
  const directory=mkdtempSync(path.join(tmpdir(),'wad-')),file=path.join(directory,'access.json');
  const providers=[];
  const control=new DesktopController({access:new AccessStore(file),browserAvailable:()=>true,clearSession:()=>{},providerFactory:opts=>{
    const provider=fixtures();provider.state='not_started';provider.closed=false;provider.opts=opts;
    provider.start=async()=>{provider.state='ready';opts.onReady();};
    provider.close=async()=>{provider.closed=true;provider.state='stopped';};
    providers.push(provider);return provider;
  }});
  control.reader.cooldownMs=0;
  t.after(async()=>{await control.close();rmSync(directory,{recursive:true,force:true});});
  return {control,directory,file,providers};
}
async function choose(control){await control.connect();await tick();assert.equal(control.phase,'choose');}
test('painel oferece seleção local e MCP permanece bloqueado até a autorização',async t=>{
  const {control,providers}=controller(t);await choose(control);
  assert.equal(providers[0].opts.headless,true);
  assert.deepEqual(control.choices.map(c=>c.id).sort(),[GROUP,PRIVATE].sort());
  await assert.rejects(()=>control.reader.execute('list_chats'),{code:'ACCESS_NOT_CONFIGURED'});
  await control.authorize([GROUP]);
  assert.equal(control.phase,'ready');assert.equal(control.status().allowed_count,1);
  assert.deepEqual((await control.reader.execute('list_chats')).chats.map(c=>c.chat_id),[GROUP]);
  await assert.rejects(()=>control.reader.execute('read_messages',{chat_id:PRIVATE}),{code:'CHAT_NOT_ALLOWED'});
});
test('seleção recusa conversa ausente, bloqueada, duplicada ou bloqueada depois da listagem',async t=>{
  const {control,providers}=controller(t);await choose(control);
  for(const ids of [[],[GROUP,GROUP],[LOCKED],['*'],['123@c.us']])await assert.rejects(()=>control.authorize(ids));
  const provider=providers[0],original=provider.chat;
  provider.chat=async id=>({...await original.call(provider,id),isLocked:true});
  await assert.rejects(()=>control.authorize([GROUP]),/não está mais disponível/);
  assert.equal(control.access.snapshot(ACCOUNT),null);
});
test('editar preserva a autorização anterior até salvar nova seleção e bloquear revoga tudo',async t=>{
  const {control,providers}=controller(t);await choose(control);await control.authorize([GROUP]);
  await control.edit();
  assert.deepEqual(control.access.snapshot(ACCOUNT)?.allowed_chat_ids,[GROUP]);
  assert.equal(control.choices.find(c=>c.id===GROUP)?.authorized,true);
  await control.authorize([GROUP]);
  const entered=deferred(),release=deferred();
  providers[0].messages=async()=>{entered.resolve();return release.promise;};
  const pending=control.reader.execute('read_messages',{chat_id:GROUP});
  await entered.promise;await control.block();release.resolve(providers[0].sourceMessages);
  await assert.rejects(()=>pending,{code:'ACCESS_REVOKED'});
  assert.equal(control.provider,null);assert.equal(control.phase,'blocked');
  assert.equal(control.access.snapshot(ACCOUNT),null);
});
test('bloqueio interrompe a troca de sessão e um callback antigo não reabre o acesso',async t=>{
  const {control,providers}=controller(t);await choose(control);await control.authorize([GROUP]);
  const entered=deferred(),release=deferred();
  providers[0].close=async()=>{entered.resolve();await release.promise;providers[0].state='stopped';};
  const reconnect=control.connect();await entered.promise;
  const blocking=control.block();release.resolve();await Promise.all([reconnect,blocking]);
  providers[0].opts.onReady();providers[0].opts.onQr('OLD_SESSION');await tick();
  assert.equal(control.phase,'blocked');assert.equal(control.provider,null);assert.equal(providers.length,1);assert.equal(control.qr,null);
});
test('bloqueio durante autorização impede gravar uma nova permissão',async t=>{
  const {control,providers}=controller(t);await choose(control);
  const entered=deferred(),release=deferred(),original=providers[0].chat;
  providers[0].chat=async id=>{entered.resolve();await release.promise;return original.call(providers[0],id);};
  const pending=control.authorize([GROUP]);await entered.promise;await control.block();release.resolve();
  await assert.rejects(()=>pending,/conexão mudou/);assert.equal(control.access.snapshot(ACCOUNT),null);
});
test('falha de conexão invalida callbacks e não transfere autorizações entre contas',async t=>{
  const {control,providers,file}=controller(t);savePolicy('550000000088@c.us',[GROUP],file);
  await control.connect({interactive:false});await tick();
  assert.equal(control.phase,'choose');assert.equal(control.access.snapshot(ACCOUNT),null);
  control.fail(control.generation);providers[0].opts.onReady();providers[0].opts.onQr('OLD');await tick();
  assert.equal(control.phase,'error');assert.equal(control.provider,null);assert.equal(control.qr,null);
});
test('QR local é uma imagem vetorial sem incorporar o texto original',()=>{
  const svg=qrSvg('<script>TESTE_SIMULADO</script>');
  assert.match(svg,/^<svg /);assert.doesNotMatch(svg,/script|TESTE_SIMULADO|https:/);
  assert.throws(()=>qrSvg('x'.repeat(4097)));
});

class AuthClientTransport {
  constructor(pipe,token,stream){this.pipe=pipe;this.token=token;this.stream=stream;this.buffer='';}
  async start(){
    this.socket=this.stream??net.createConnection(this.pipe);this.socket.on('error',error=>this.onerror?.(error));
    this.socket.on('close',()=>this.onclose?.());
    this.socket.on('data',chunk=>{this.buffer+=chunk.toString();while(this.buffer.includes('\n')){const i=this.buffer.indexOf('\n'),line=this.buffer.slice(0,i);this.buffer=this.buffer.slice(i+1);this.onmessage?.(JSON.parse(line));}});
    if(!this.stream)await once(this.socket,'connect');this.socket.write(JSON.stringify({authenticate:this.token})+'\n');
  }
  async send(message){this.socket.write(JSON.stringify(message)+'\n');}
  async close(){this.socket.destroy();}
}
async function service(t){
  const {control,directory}=controller(t);
  try{
    const service=await startDesktopService({controller:control,directory,executable,register:()=>{},isRegistered:()=>false,writeDiscovery:false});
    t.after(()=>service.close());return service;
  }catch(error){
    if(error.code==='EPERM'&&error.syscall==='listen'){t.skip('Ambiente impediu abrir o servidor local (EPERM). Integração real pendente.');return null;}
    throw error;
  }
}
test('HTTP local exige segredo e origem correta e não expõe arquivos ou ações arbitrárias',async t=>{
  const server=await service(t);if(!server)return;const d=server.discovery;
  const request=(route,options={})=>fetch(d.origin+route,{...options,headers:{Authorization:'Bearer '+d.ui_token,...options.headers}});
  assert.equal((await fetch(d.origin+'/api/status')).status,403);
  assert.equal((await request('/api/status',{headers:{Authorization:'Bearer '+'é'.repeat(64)}})).status,403);
  assert.equal((await request('/api/status',{headers:{Origin:'https://malicioso.example'}})).status,403);
  const maliciousHostStatus = await new Promise((resolve, reject) => {
    const parsed = new URL(d.origin);
    const req = http.request({
      host: parsed.hostname,
      port: parsed.port,
      path: '/api/status',
      method: 'GET',
      headers: { Host: 'malicioso.example', Authorization: 'Bearer ' + d.ui_token }
    }, res => resolve(res.statusCode));
    req.on('error', reject);
    req.end();
  });
  assert.equal(maliciousHostStatus, 403);
  assert.equal((await request('/src/access.mjs')).status,403);
  const state=await request('/api/status');assert.equal(state.status,200);
  assert.match(state.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  assert.equal(state.headers.get('cache-control'),'no-store');
  assert.doesNotMatch(await state.text(),new RegExp(d.ui_token+'|'+d.ipc_token));
  const post=(route,input)=>request(route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
  assert.equal((await post('/api/setup',{command:'arbitrary'})).status,400);
  assert.equal((await post('/api/send',{})).status,404);
  assert.equal((await post('/api/setup',{})).status,200);await tick();
  const choices=await (await request('/api/chats')).json();assert.equal(choices.chats.length,2);
  assert.equal((await post('/api/authorize',{chat_ids:[GROUP],allow_all:true})).status,400);
  assert.equal((await post('/api/authorize',{chat_ids:[GROUP]})).status,200);
  assert.equal((await post('/api/block',{})).status,200);
  assert.equal(server.controller.phase,'blocked');
});
test('canal local recusa segredo incorreto e anuncia leitura e escrita com scopes aplicados em execução',async t=>{
  const server=await service(t);if(!server)return;const d=server.discovery;
  const bad=net.createConnection(d.pipe);bad.on('error',()=>{});await once(bad,'connect');
  const rejected=once(bad,'close');bad.write(JSON.stringify({authenticate:d.ui_token})+'\n');await rejected;
  await choose(server.controller);await server.controller.authorize([GROUP]);
  const client=new Client({name:'desktop-test',version:'1.0.0'});
  try{
    await client.connect(new AuthClientTransport(d.pipe,d.ipc_token));
    const result=await client.listTools();
    assert.deepEqual(result.tools.map(t=>t.name).sort(),['create_group','get_status','list_chats','manage_group_participants','read_messages','search_messages','send_message','update_group']);
    const deniedWrite=await client.callTool({name:'send_message',arguments:{chat_id:GROUP,text:'negado',idempotency_key:'desktop-denied-1'}});
    assert.equal(deniedWrite.isError,true);
    assert.equal(deniedWrite.structuredContent.error.code,'WRITE_SCOPE_REQUIRED');
    assert.ok(result.tools.filter(t=>['get_status','list_chats','read_messages','search_messages'].includes(t.name)).every(t=>t.annotations.readOnlyHint));
    assert.ok(result.tools.filter(t=>['send_message','create_group','update_group','manage_group_participants'].includes(t.name)).every(t=>!t.annotations.readOnlyHint));
    const data=await client.callTool({name:'read_messages',arguments:{chat_id:GROUP,limit:1}});
    assert.match(data.structuredContent.messages[0].text,/SIMULADO/);
    assert.doesNotMatch(JSON.stringify(data),new RegExp(d.ui_token+'|'+d.ipc_token));
    const status=await fetch(d.origin+'/api/status',{headers:{Authorization:'Bearer '+d.ui_token}});
    assert.ok((await status.json()).last_mcp_seen);
    await server.controller.block();
    assert.equal((await client.callTool({name:'read_messages',arguments:{chat_id:GROUP}})).isError,true);
  }finally{await client.close();}
});

test('tratador HTTP valida origem, autenticação, tamanho e ações sem depender de sockets',async t=>{
  const {control}=controller(t),token=randomBytes(32).toString('hex');
  const connection={origin:'http://127.0.0.1:48563',uiToken:token,registered:false,lastMcpSeen:null};let registered=0;
  const handle=createWebHandler(control,connection,()=>{registered++;});
  async function request(route,{method='GET',headers={},body}={}){
    const req=Readable.from(body===undefined?[]:[Buffer.from(body)]);req.method=method;req.url=route;
    req.headers={host:'127.0.0.1:48563',authorization:'Bearer '+token,...headers};
    const output={headers:{}};
    const res={setHeader(k,v){output.headers[k.toLowerCase()]=v;},writeHead(status,headers){output.status=status;for(const [k,v] of Object.entries(headers??{}))this.setHeader(k,v);},end(body){output.body=String(body??'');}};
    await handle(req,res);return output;
  }
  for(const headers of [{authorization:''},{authorization:'Bearer '+'é'.repeat(64)},{origin:'https://malicioso.example'},{host:'malicioso.example'}]){
    assert.equal((await request('/api/status',{headers})).status,403);
  }
  const status=await request('/api/status');assert.equal(status.status,200);assert.doesNotMatch(status.body,new RegExp(token));
  assert.match(status.headers['content-security-policy'],/frame-ancestors 'none'/);
  assert.equal((await request('/src/access.mjs')).status,403);
  const post=(route,input)=>request(route,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});
  assert.equal((await post('/api/setup',{command:'arbitrary'})).status,400);assert.equal(registered,0);
  assert.equal((await post('/api/setup',{})).status,200);await tick();assert.equal(registered,1);
  assert.equal((await post('/api/send',{})).status,404);
  assert.equal((await post('/api/authorize',{chat_ids:[GROUP],extra:true})).status,400);
  assert.equal((await post('/api/authorize',{chat_ids:['x'.repeat(9000)]})).status,400);
  assert.equal((await post('/api/authorize',{chat_ids:[GROUP]})).status,200);
  assert.equal((await post('/api/block',{})).status,200);assert.equal(control.phase,'blocked');
});
test('transporte MCP em memória autentica e não concede ferramentas de configuração ou envio',async t=>{
  const {control}=controller(t);await choose(control);await control.authorize([GROUP]);
  const token=randomBytes(32).toString('hex'),[serverSide,clientSide]=duplexPair();
  const server=createMcpServer(control.reader),client=new Client({name:'memory-test',version:'1.0.0'});
  try{
    await server.connect(new PipeTransport(serverSide,token));
    await client.connect(new AuthClientTransport(null,token,clientSide));
    assert.deepEqual((await client.listTools()).tools.map(t=>t.name).sort(),['get_status','list_chats','read_messages','search_messages']);
    assert.match((await client.callTool({name:'read_messages',arguments:{chat_id:GROUP,limit:1}})).structuredContent.messages[0].text,/SIMULADO/);
    await control.block();assert.equal((await client.callTool({name:'list_chats',arguments:{}})).isError,true);
  }finally{await client.close();await server.close();clientSide.destroy();serverSide.destroy();}
});
test('transporte fecha antes do MCP quando a autenticação está ausente ou inválida',async()=>{
  for(const message of [{authenticate:'é'.repeat(64)},{authenticate:'x'.repeat(64)},{jsonrpc:'2.0',method:'initialize',id:1}]){
    const [serverSide,clientSide]=duplexPair(),transport=new PipeTransport(serverSide,'a'.repeat(64));let received=0;
    transport.onmessage=()=>received++;await transport.start();const closed=once(serverSide,'close');
    clientSide.write(JSON.stringify(message)+'\n');await closed;assert.equal(received,0);clientSide.destroy();
  }
});

test('F07: switchAccount aguarda close; block é acionado; close termina. O estado continua blocked e nenhum novo pareamento começa', async t => {
  const directory = sandbox(t);
  const accessFile = path.join(directory, 'access.json');
  savePolicy(ACCOUNT, [GROUP], accessFile);
  const access = new AccessStore(accessFile);

  let resolveClose;
  const closePromise = new Promise(r => { resolveClose = r; });
  let startCalls = 0;

  const mockProvider = {
    closed: false,
    state: 'ready',
    accountId: () => ACCOUNT,
    status: () => ({ connected: true, state: 'ready' }),
    start: async () => { startCalls++; },
    close: async () => { await closePromise; mockProvider.closed = true; },
    logout: async () => { await closePromise; mockProvider.closed = true; }
  };

  const control = new DesktopController({
    access,
    providerFactory: () => mockProvider,
    browserAvailable: () => true
  });
  t.after(() => control.close());

  control.provider = mockProvider;
  control.phase = 'ready';

  const switchPromise = control.switchAccount();
  await control.block();
  assert.equal(control.phase, 'blocked');

  resolveClose();
  await switchPromise;

  assert.equal(control.phase, 'blocked');
  assert.equal(startCalls, 0);
  assert.equal(control.provider, null);
});

test('F03: subprocesso independente criado para o teste permanece vivo; encerramento autenticado via /api/shutdown', async t => {
  const { spawn, execSync } = await import('node:child_process');
  const { serviceFile } = await import('../src/desktop-process.mjs');
  const { writePrivateJson } = await import('../src/local-security.mjs');

  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{}, 1000)'], {
    windowsHide: true,
    stdio: 'ignore'
  });
  child.unref();
  t.after(() => {
    try {
      if (process.platform === 'win32') {
        execSync(`taskkill /F /PID ${child.pid}`, { stdio: 'ignore' });
      } else {
        child.kill('SIGKILL');
      }
    } catch {}
  });

  const childPid = child.pid;
  assert.ok(childPid > 0);

  const service = await startDesktopService({ writeDiscovery: false });
  t.after(() => service.close());

  const origin = service.discovery.origin;
  const uiToken = service.discovery.ui_token;

  const shutdownRes = await fetch(`${origin}/api/shutdown`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${uiToken}`,
      'Content-Type': 'application/json'
    },
    body: '{}'
  });
  assert.equal(shutdownRes.ok, true);

  await new Promise(r => setTimeout(r, 200));

  let alive = true;
  try {
    process.kill(childPid, 0);
  } catch {
    alive = false;
  }
  assert.equal(alive, true, 'Subprocesso independente jamais deve ser encerrado.');
});
