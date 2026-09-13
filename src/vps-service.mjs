import http from 'node:http';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { AccessStore } from './access.mjs';
import { DesktopController } from './desktop-controller.mjs';
import { WhatsAppProvider, chromePath, clearSessionMaintenance } from './provider.mjs';
import { createGptHandler } from './gpt-handler.mjs';
import { getOrCreateGptToken } from './gpt-tunnel.mjs';
import { readPrivateJson, secureDirectory, writePrivateJson } from './local-security.mjs';

const json=(res,status,data)=>{const body=JSON.stringify(data);res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(body);};
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const bearer=req=>String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
const safePort=value=>{const port=Number(value);if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('WA_PORT inválida.');return port;};
export function normalizePublicBase(value) {
  if(!value)return null;const url=new URL(value);
  if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('WA_PUBLIC_BASE_URL deve ser uma origem HTTPS sem caminho.');
  return url.origin;
}
export function getOrCreateAdminToken(directory) {
  secureDirectory(directory);const file=path.join(directory,'vps-admin.json');
  try{const data=readPrivateJson(file);if(typeof data.admin_token==='string'&&/^[a-f0-9]{64}$/.test(data.admin_token))return data.admin_token;}catch{}
  const token=randomBytes(32).toString('hex');writePrivateJson(file,{version:1,created_at:new Date().toISOString(),admin_token:token});return token;
}async function readJson(req,limit=32768){
  if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))throw new Error('Content-Type deve ser application/json.');
  const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>limit)throw new Error('Corpo excede o limite.');chunks.push(chunk);}
  if(!chunks.length)return {};try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new Error('JSON inválido.');}
}
function adminSnapshot(controller){
  const state=controller.status();
  return {phase:state.phase,connected:state.connected,browser_available:state.browser_available,allowed_count:state.allowed_count,
    scopes:state.scopes,error:state.error||null,qr_svg:state.qr_svg||null,
    choices:state.phase==='choose'?controller.choices.map(c=>({id:c.id,name:c.name,group:c.group,authorized:c.authorized})):[]};
}
export function createVpsHandler({controller,adminToken,gptHandler}){
  const adminHtml=readFileSync(new URL('../vps-admin/index.html',import.meta.url));
  const adminJs=readFileSync(new URL('../vps-admin/app.js',import.meta.url));
  return async(req,res)=>{
    let url;try{url=new URL(req.url,'http://127.0.0.1');}catch{return json(res,400,{error:'Solicitação inválida.'});}
    if(req.method==='GET'&&url.pathname==='/health'){
      const s=controller.status();return json(res,200,{service:'whatsapp-manutencao',version:'0.3.0',deployment_profile:'vps-alpha',alive:true,whatsapp_ready:Boolean(s.connected),phase:s.phase,browser_available:Boolean(s.browser_available)});
    }
    if(req.method==='GET'&&url.pathname==='/admin'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});return res.end(adminHtml);}
    if(req.method==='GET'&&url.pathname==='/admin/app.js'){res.writeHead(200,{'Content-Type':'application/javascript; charset=utf-8','Cache-Control':'no-store'});return res.end(adminJs);}
    if(url.pathname.startsWith('/gpt/'))return gptHandler(req,res,url);
    if(!url.pathname.startsWith('/admin/'))return json(res,404,{error:'Não encontrado.'});
    if(!equal(bearer(req),adminToken))return json(res,401,{error:'Autenticação administrativa necessária.'});
    try{
      if(req.method==='GET'&&url.pathname==='/admin/status')return json(res,200,adminSnapshot(controller));      if(req.method==='POST'&&url.pathname==='/admin/connect'){await controller.connect({interactive:true});return json(res,200,{ok:true});}
      if(req.method==='POST'&&url.pathname==='/admin/reconnect'){await controller.connect({interactive:false});return json(res,200,{ok:true});}
      if(req.method==='POST'&&url.pathname==='/admin/edit'){await controller.edit();return json(res,200,{ok:true});}
      if(req.method==='POST'&&url.pathname==='/admin/block'){await controller.block();return json(res,200,{ok:true});}
      if(req.method==='POST'&&url.pathname==='/admin/switch-account'){await controller.switchAccount();return json(res,200,{ok:true});}
      if(req.method==='POST'&&url.pathname==='/admin/authorize'){
        const body=await readJson(req);
        const keys=Object.keys(body).sort();if(keys.some(k=>!['chat_ids','scopes'].includes(k))||!keys.includes('chat_ids'))throw new Error('Solicitação inválida.');
        await controller.authorize(body.chat_ids,body.scopes??['whatsapp.read']);return json(res,200,{ok:true});
      }
      return json(res,404,{error:'Ação administrativa não encontrada.'});
    }catch(error){return json(res,400,{error:error instanceof Error?error.message:'Falha administrativa.'});}
  };
}
export async function startVpsService({directory='/var/lib/whatsapp-manutencao',port=8787,publicBase=null,controller=null,autoConnect=true}={}){
  secureDirectory(directory);port=safePort(port);publicBase=normalizePublicBase(publicBase);if(!publicBase)throw new Error('WA_PUBLIC_BASE_URL é obrigatória na VPS.');
  const access=new AccessStore(path.join(directory,'access.json'));
  controller??=new DesktopController({access,browserAvailable:()=>Boolean(chromePath()),
    providerFactory:opts=>new WhatsAppProvider({...opts,dataPath:directory}),clearSession:()=>clearSessionMaintenance(directory)});
  const gptToken=getOrCreateGptToken(directory),adminToken=getOrCreateAdminToken(directory);
  const gptHandler=createGptHandler({getReader:()=>controller.reader,getWriter:()=>controller.writer,getGptToken:()=>gptToken,getPublicUrl:()=>publicBase});
  const server=http.createServer(createVpsHandler({controller,adminToken,gptHandler}));
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  if(autoConnect)void controller.connect({interactive:false}).catch(()=>{});
  const close=async()=>{await controller.close();await new Promise(resolve=>server.close(resolve));};
  return {server,controller,adminToken,gptToken,origin:`http://127.0.0.1:${port}`,publicBase,close};
}