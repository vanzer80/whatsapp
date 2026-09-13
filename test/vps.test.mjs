import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createVpsHandler, getOrCreateAdminToken, normalizePublicBase, startVpsService } from '../src/vps-service.mjs';

async function serve(handler){const server=http.createServer(handler);await new Promise((r,j)=>{server.once('error',j);server.listen(0,'127.0.0.1',r);});return {server,base:`http://127.0.0.1:${server.address().port}`};}
function controller(){const calls=[];return {calls,choices:[{id:'120000000001@g.us',name:'Grupo teste',group:true,authorized:true}],status(){return {phase:'choose',connected:true,browser_available:true,allowed_count:1,scopes:['whatsapp.read','whatsapp.send'],error:null,qr_svg:'<svg>QR_SECRET</svg>'};},async connect(v){calls.push(['connect',v]);},async edit(){calls.push(['edit']);},async block(){calls.push(['block']);},async switchAccount(){calls.push(['switch']);},async authorize(ids,scopes){calls.push(['authorize',ids,scopes]);}};}

test('base pública da VPS aceita somente origem HTTPS limpa',()=>{
  assert.equal(normalizePublicBase('https://wa.example.com'),'https://wa.example.com');
  assert.throws(()=>normalizePublicBase('http://wa.example.com'));
  assert.throws(()=>normalizePublicBase('https://wa.example.com/path'));
});
test('token administrativo é persistente e privado por valor aleatório',t=>{
  const dir=mkdtempSync(path.join(tmpdir(),'wa-vps-token-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const first=getOrCreateAdminToken(dir),second=getOrCreateAdminToken(dir);assert.match(first,/^[a-f0-9]{64}$/);assert.equal(second,first);
});test('health não expõe QR, tokens, IDs ou contagem autorizada; admin exige token',async t=>{
  const c=controller(),adminToken='a'.repeat(64),gptHandler=async(req,res)=>{res.writeHead(200,{'Content-Type':'application/json'});res.end('{"gpt":true}');return true;};
  const {server,base}=await serve(createVpsHandler({controller:c,adminToken,gptHandler}));t.after(()=>new Promise(r=>server.close(r)));
  const health=await (await fetch(base+'/health')).json();assert.equal(health.alive,true);const h=JSON.stringify(health);assert.doesNotMatch(h,/QR_SECRET|120000000001|allowed_count|admin/i);
  const denied=await fetch(base+'/admin/status');assert.equal(denied.status,401);
  const ok=await fetch(base+'/admin/status',{headers:{Authorization:`Bearer ${adminToken}`}});assert.equal(ok.status,200);const state=await ok.json();assert.match(state.qr_svg,/QR_SECRET/);assert.equal(state.choices.length,1);
  const delegated=await fetch(base+'/gpt/openapi.json');assert.equal(delegated.status,200);assert.deepEqual(await delegated.json(),{gpt:true});
});

test('administração remota fica autenticada e autoriza somente payload esperado',async t=>{
  const c=controller(),adminToken='b'.repeat(64),gptHandler=async()=>false;
  const {server,base}=await serve(createVpsHandler({controller:c,adminToken,gptHandler}));t.after(()=>new Promise(r=>server.close(r)));
  const headers={Authorization:`Bearer ${adminToken}`,'Content-Type':'application/json'};
  const body={chat_ids:['120000000001@g.us'],scopes:['whatsapp.read','whatsapp.send']};
  const res=await fetch(base+'/admin/authorize',{method:'POST',headers,body:JSON.stringify(body)});assert.equal(res.status,200);
  assert.deepEqual(c.calls.at(-1),['authorize',body.chat_ids,body.scopes]);
  const bad=await fetch(base+'/admin/authorize',{method:'POST',headers,body:JSON.stringify({...body,extra:true})});assert.equal(bad.status,400);
  const pair=await fetch(base+'/admin/connect',{method:'POST',headers});assert.equal(pair.status,200);assert.deepEqual(c.calls.at(-1),['connect',{interactive:true}]);
});

test('runtime VPS falha fechado quando WA_PUBLIC_BASE_URL não é configurada',async t=>{
  const dir=mkdtempSync(path.join(tmpdir(),'wa-vps-no-public-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  await assert.rejects(()=>startVpsService({directory:dir,port:18787,publicBase:null,autoConnect:false}),/WA_PUBLIC_BASE_URL é obrigatória/);
});

test('entrypoint VPS encerra com código 1 em exceção fatal ou rejeição não tratada',()=>{
  const source=readFileSync(new URL('../scripts/vps-service.mjs',import.meta.url),'utf8');
  assert.match(source,/uncaughtException[^\n]*shutdown\(1\)/);
  assert.match(source,/unhandledRejection[^\n]*shutdown\(1\)/);
  assert.match(source,/async function shutdown\(code=0\)/);
});
