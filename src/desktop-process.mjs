import { spawn } from 'node:child_process';
import { existsSync, writeFileSync, unlinkSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataDirectory, minimalEnvironment, noLinks, readPrivateJson, secureDirectory } from './local-security.mjs';

export const releaseRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const launcherPath=()=>path.resolve(releaseRoot,'..','WhatsApp-Manutencao.exe');
export const serviceFile=()=>path.join(dataDirectory(),'desktop-service.json');
export function readDiscovery() {
  try {
    const d=readPrivateJson(serviceFile());
    if(d.version!=='0.3.0'||!/^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(d.origin)||
       !/^[a-f0-9]{64}$/.test(d.ui_token)||!/^[a-f0-9]{64}$/.test(d.ipc_token)||
       !Number.isSafeInteger(d.pid)||d.pid<1||typeof d.pipe!=='string')return null;
    if(d.executable!==launcherPath() && path.basename(d.executable).toLowerCase()!=='whatsapp-manutencao.exe')return null;
    if(process.platform==='win32'&&!/^\\\\\.\\pipe\\WhatsAppManutencao-[a-f0-9-]{36}$/.test(d.pipe))return null;
    if(process.platform!=='win32'&&path.dirname(d.pipe)!==dataDirectory())return null;
    return d;
  }catch{return null;}
}
export async function running() {
  const d=readDiscovery();if(!d)return null;
  try {
    const r=await fetch(d.origin+'/api/status',{headers:{Authorization:`Bearer ${d.ui_token}`},redirect:'error',signal:AbortSignal.timeout(1500)});
    if(!r.ok)return null;
    const state=await r.json();
    if(state.version!=='0.3.0'||state.build_id!=='0.3.0-r3')return null;
    if(!Array.isArray(state.capabilities)||!state.capabilities.includes('mcp_reader')||!state.capabilities.includes('gpt_actions'))return null;
    return d;
  }catch{return null;}
}
export async function ensureRunning() {
  secureDirectory();
  const existing=await running();
  if(existing)return existing;
  const oldDisc=readDiscovery();
  if(oldDisc?.origin && oldDisc?.ui_token) {
    try {
      await fetch(oldDisc.origin+'/api/shutdown',{
        method:'POST',
        headers:{'Content-Type':'application/json',Authorization:`Bearer ${oldDisc.ui_token}`},
        body:'{}',
        redirect:'error',
        signal:AbortSignal.timeout(1500)
      });
      await new Promise(resolve=>setTimeout(resolve,300));
    } catch {}
  }
  const env=minimalEnvironment();
  if (process.platform === 'win32') {
    const sysRoot=env.SystemRoot||env.WINDIR||'C:\\Windows';
    env.PATH=`${sysRoot}\\System32;${sysRoot}`;
  }
  const child=spawn(process.execPath,[path.join(releaseRoot,'scripts/desktop-service.mjs')],{
    cwd:releaseRoot,env,windowsHide:true,detached:true,stdio:'ignore'
  });
  let spawnError=false;child.once('error',()=>{spawnError=true;});child.unref();
  const until=Date.now()+35000;
  while(Date.now()<until&&!spawnError){await new Promise(resolve=>setTimeout(resolve,300));const d=await running();if(d)return d;}
  throw new Error('Não foi possível iniciar o aplicativo local. Feche outras instâncias e tente novamente.');
}
export function acquireLock() {
  secureDirectory();const file=path.join(dataDirectory(),'desktop-service.lock');noLinks(file);
  for(let attempt=0;attempt<2;attempt++){
    try{writeFileSync(file,JSON.stringify({pid:process.pid}),{flag:'wx',mode:0o600});return ()=>{try{if(JSON.parse(readFileSync(file,'utf8')).pid===process.pid)unlinkSync(file);}catch{}};}
    catch(error){
      if(error.code!=='EEXIST')throw error;
      let previous;try{previous=readPrivateJson(file);}catch{throw new Error('O bloqueio de execução precisa ser revisado.');}
      if(!Number.isSafeInteger(previous?.pid)||previous.pid<1)throw new Error('O bloqueio de execução precisa ser revisado.');
      let live=true;try{process.kill(previous.pid,0);}catch(e){if(e.code==='ESRCH')live=false;}
      if(live)throw new Error('O aplicativo já está aberto.');
      if(existsSync(file))unlinkSync(file);
    }
  }
  throw new Error('Outra instância está iniciando.');
}
