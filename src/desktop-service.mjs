import http from 'node:http';
import net from 'node:net';
import { readFileSync, chmodSync, unlinkSync, existsSync } from 'node:fs';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { JSONRPCMessageSchema } from '@modelcontextprotocol/sdk/types.js';
import { createMcpServer } from './server.mjs';
import { DesktopController } from './desktop-controller.mjs';
import { registerLocal, registrationStatus } from './desktop-registration.mjs';
import { dataDirectory, secureDirectory, writePrivateJson } from './local-security.mjs';
import { createGptHandler } from './gpt-handler.mjs';
import { getOrCreateGptToken, CloudflareTunnelManager } from './gpt-tunnel.mjs';

const equal=(a,b)=>typeof a==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export class PipeTransport {
  constructor(socket,token) {
    this.socket=socket;this.token=token;this.authenticated=false;this.buffer=Buffer.alloc(0);
  }
  async start() {
    this.deadline=setTimeout(()=>this.socket.destroy(),5000);this.deadline.unref();
    this.socket.on('data',chunk=>{
      this.buffer=Buffer.concat([this.buffer,chunk]);
      if(this.buffer.length>65536){this.socket.destroy();return;}
      while(this.buffer.includes(10)) {
        const pos=this.buffer.indexOf(10),line=this.buffer.subarray(0,pos);this.buffer=this.buffer.subarray(pos+1);
        try {
          const parsed=JSON.parse(line.toString('utf8'));
          if(!this.authenticated){
            if(!parsed || Object.keys(parsed).length!==1 || !equal(parsed.authenticate,this.token)){this.socket.destroy();return;}
            this.authenticated=true;clearTimeout(this.deadline);continue;
          }
          this.onmessage?.(JSONRPCMessageSchema.parse(parsed));
        } catch {this.socket.destroy();return;}
      }
    });
    this.socket.on('close',()=>{clearTimeout(this.deadline);this.onclose?.();});
    this.socket.on('error',error=>this.onerror?.(error));
  }
  async send(message) {
    if(this.socket.destroyed)throw new Error('Conexão local encerrada.');
    await new Promise((resolve,reject)=>this.socket.write(JSON.stringify(message)+'\n',error=>error?reject(error):resolve()));
  }
  async close(){clearTimeout(this.deadline);this.socket.destroy();}
}
const assets=new Map([['/','index.html'],['/app.js','app.js'],['/style.css','style.css']]);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
function send(response,status,data) {response.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});response.end(JSON.stringify(data));}
async function body(request) {
  if(!/^application\/json(?:;|$)/i.test(request.headers['content-type']??''))throw new Error('Formato de solicitação inválido.');
  const chunks=[];let length=0;
  for await(const chunk of request){length+=chunk.length;if(length>8192)throw new Error('Solicitação excede o limite.');chunks.push(chunk);}
  const result=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if(!result||Array.isArray(result)||typeof result!=='object')throw new Error('Solicitação inválida.');
  return result;
}
export function createWebHandler(controller,connection,register=()=>{},gptHandler=null,tunnelManager=null,onShutdown=null) {
  return async(request,response)=>{
    const {origin,uiToken}=connection;
    let pathname,parsedUrl;
    try {
      parsedUrl=new URL(request.url,origin||`http://${request.headers.host||'127.0.0.1'}`);
      pathname=parsedUrl.pathname;
    } catch {
      send(response,400,{error:'Solicitação inválida.'});return;
    }

    if(pathname.startsWith('/gpt/')) {
      if(gptHandler) {
        const handled=await gptHandler(request,response,parsedUrl);
        if(handled)return;
      }
      send(response,404,{error:'Ação não encontrada.'});return;
    }

    response.setHeader('Cache-Control','no-store');response.setHeader('X-Content-Type-Options','nosniff');
    response.setHeader('Referrer-Policy','no-referrer');response.setHeader('X-Frame-Options','DENY');
    response.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    if(request.headers.host!==new URL(origin).host || (request.headers.origin&&request.headers.origin!==origin)) {send(response,403,{error:'Origem não autorizada.'});return;}
    if(request.method==='GET'&&assets.has(pathname)) {
      const file=assets.get(pathname);response.writeHead(200,{'Content-Type':mime[path.extname(file)]});
      response.end(readFileSync(new URL(`../desktop-ui/${file}`,import.meta.url)));return;
    }
    if(!pathname.startsWith('/api/')||!equal(request.headers.authorization,`Bearer ${uiToken}`)) {send(response,403,{error:'Abra o aplicativo pelo ícone WhatsApp Manutenção.'});return;}
    try {
      if(request.method==='GET'&&pathname==='/api/status') {
        send(response,200,{
          ...controller.status(),
          registered:connection.registered,
          last_mcp_seen:connection.lastMcpSeen,
          gpt_token:connection.gptToken,
          public_url:connection.publicUrl,
          tunnel_active:Boolean(connection.tunnelActive && connection.publicUrl),
          external_query_confirmed:Boolean(connection.externalQueryConfirmed),
          capabilities:connection.capabilities,
          build_id:connection.build_id
        });
        return;
      }
      if(request.method==='GET'&&pathname==='/api/chats') {send(response,200,{chats:controller.phase==='choose'?controller.choices:[]});return;}
      if(request.method!=='POST'){send(response,404,{error:'Ação não encontrada.'});return;}
      const input=await body(request);
      if(!['/api/authorize','/api/tunnel','/api/shutdown'].includes(pathname)&&Object.keys(input).length)throw new Error('Solicitação inválida.');
      if(pathname==='/api/setup') {register();connection.registered=true;await controller.connect();}
      else if(pathname==='/api/connect')await controller.connect();
      else if(pathname==='/api/edit')await controller.edit();
      else if(pathname==='/api/authorize') {
        const keys=Object.keys(input).sort();
        if(keys.some(k=>!['chat_ids','scopes'].includes(k))||!keys.includes('chat_ids'))throw new Error('Solicitação inválida.');
        await controller.authorize(input.chat_ids,input.scopes??['whatsapp.read']);
      }
      else if(pathname==='/api/block')await controller.block();
      else if(pathname==='/api/disconnect')await controller.disconnect();
      else if(pathname==='/api/switch-account')await controller.switchAccount();
      else if(pathname==='/api/shutdown') {
        send(response,200,{ok:true});
        if(onShutdown)setTimeout(()=>onShutdown(),50);
        return;
      }
      else if(pathname==='/api/tunnel/start') {
        if(!tunnelManager)throw new Error('Gerenciador de túnel indisponível.');
        const port=new URL(origin).port;
        const res=await tunnelManager.start({localPort:port});
        connection.publicUrl=res.url;
        connection.tunnelActive=true;
        send(response,200,{ok:true,url:res.url});
        return;
      }
      else if(pathname==='/api/tunnel/stop') {
        if(tunnelManager)tunnelManager.stop();
        connection.publicUrl=null;
        connection.tunnelActive=false;
        send(response,200,{ok:true});
        return;
      }
      else if(pathname==='/api/tunnel') {
        if(typeof input.url!=='string'||!/^https:\/\/[a-zA-Z0-9-.]+\.[a-zA-Z]{2,}(?::\d+)?$/.test(input.url)) {
          throw new Error('URL de túnel HTTPS válida é obrigatória.');
        }
        connection.publicUrl=input.url;
        connection.tunnelActive=true;
        send(response,200,{ok:true,url:input.url});
        return;
      }
      else {send(response,404,{error:'Ação não encontrada.'});return;}
      send(response,200,{ok:true});
    } catch(error) {
      const allowed=/^(Selecione|Conecte|Aguarde|A seleção|Uma conversa|A conexão mudou|Já existe uma conexão|A configuração|O registro|Caminho do aplicativo|URL de túnel|O túnel)/;
      send(response,400,{error:allowed.test(error.message)?error.message:'Não foi possível concluir esta etapa. Tente novamente pelo aplicativo.'});
    }
  };
}
export async function startDesktopService({controller=new DesktopController(),directory=dataDirectory(),executable,
  register=()=>registerLocal(executable),isRegistered=()=>registrationStatus(executable),writeDiscovery=true,
  tunnelUrl=null}={}) {
  secureDirectory(directory);
  const uiToken=randomBytes(32).toString('hex'),ipcToken=randomBytes(32).toString('hex'),gptToken=getOrCreateGptToken(directory);
  const pipe=process.platform==='win32'?`\\\\.\\pipe\\WhatsAppManutencao-${randomUUID()}`:path.join(directory,`ipc-${randomUUID().slice(0,12)}.sock`);
  const connection={
    uiToken,
    ipcToken,
    gptToken,
    registered:isRegistered(),
    lastMcpSeen:null,
    origin:null,
    publicUrl:tunnelUrl,
    externalQueryConfirmed:false,
    capabilities:['mcp_reader','mcp_writer','gpt_actions','gpt_write_actions'],
    build_id:'0.3.0-r2'
  };
  const tunnelManager=new CloudflareTunnelManager({directory});
  tunnelManager.onUrlChange=url=>{connection.publicUrl=url;};
  tunnelManager.onClose=()=>{connection.publicUrl=null;};

  const gptHandler=createGptHandler({
    getReader:()=>controller.reader,
    getWriter:()=>controller.writer,
    getGptToken:()=>connection.gptToken,
    getPublicUrl:()=>connection.publicUrl||null,
    onExternalQuery:()=>{connection.externalQueryConfirmed=true;}
  });
  const connections=new Set();let closed=false,origin;
  const pipeServer=net.createServer(socket=>{
    socket.setNoDelay(true);connections.add(socket);socket.once('close',()=>connections.delete(socket));
    const server=createMcpServer(controller.reader,controller.writer);
    server.server.oninitialized=()=>{connection.lastMcpSeen=new Date().toISOString();};
    server.connect(new PipeTransport(socket,ipcToken)).catch(()=>socket.destroy());
  });
  pipeServer.maxConnections=20;
  let serviceHandle;
  const web=http.createServer(createWebHandler(controller,connection,register,gptHandler,tunnelManager,()=>serviceHandle?.close()));
  web.maxConnections=50;web.maxHeadersCount=30;web.requestTimeout=10000;web.headersTimeout=10000;web.keepAliveTimeout=5000;
  const discoveryFile=path.join(directory,'desktop-service.json');
  let discovery;
  try {
    await new Promise((resolve,reject)=>{pipeServer.once('error',reject);pipeServer.listen(pipe,resolve);});
    if(process.platform!=='win32')chmodSync(pipe,0o600);
    await new Promise((resolve,reject)=>{web.once('error',reject);web.listen(0,'127.0.0.1',resolve);});
    origin=`http://127.0.0.1:${web.address().port}`;connection.origin=origin;
    discovery={
      version:'0.3.0',
      build_id:connection.build_id,
      capabilities:connection.capabilities,
      pid:process.pid,
      origin,
      ui_token:uiToken,
      ipc_token:ipcToken,
      gpt_token:gptToken,
      pipe,
      executable
    };
    if(writeDiscovery)writePrivateJson(discoveryFile,discovery);
  } catch(error) {
    for(const socket of connections)socket.destroy();
    await Promise.all([new Promise(resolve=>pipeServer.close(resolve)),new Promise(resolve=>web.close(resolve))]);
    if(process.platform!=='win32'&&existsSync(pipe))unlinkSync(pipe);
    throw error;
  }
  const monitor=setInterval(()=>{
    if(controller.phase==='ready' && (!controller.provider?.status().connected || !controller.access.snapshot(controller.provider?.accountId())))
      void controller.block().catch(()=>controller.close());
  },1500);monitor.unref();
  serviceHandle = {
    discovery,
    controller,
    tunnelManager,
    connection,
    async close(){
      if(closed)return;closed=true;clearInterval(monitor);
      tunnelManager.stop();
      await controller.close();
      for(const socket of connections)socket.destroy();
      await Promise.all([new Promise(resolve=>pipeServer.close(resolve)),new Promise(resolve=>{web.closeAllConnections();web.close(resolve);})]);
      if(writeDiscovery&&existsSync(discoveryFile))unlinkSync(discoveryFile);
      if(process.platform!=='win32'&&existsSync(pipe))unlinkSync(pipe);
    }
  };
  return serviceHandle;
}
