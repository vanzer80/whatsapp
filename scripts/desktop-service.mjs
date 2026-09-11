import { minimalEnvironment } from '../src/local-security.mjs';
const safe=minimalEnvironment();for(const key of Object.keys(process.env))if(!(key in safe))delete process.env[key];
if (process.platform === 'win32') {
  const sysRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
  process.env.PATH = `${sysRoot}\\System32;${sysRoot}`;
}
let unlock,service;
try {
  const {acquireLock,launcherPath}=await import('../src/desktop-process.mjs');
  unlock=acquireLock();
  service=await (await import('../src/desktop-service.mjs')).startDesktopService({executable:launcherPath()});
  if(service.controller.access.load()?.allowed_chat_ids.length)void service.controller.connect({interactive:false});
  let stopping=false;
  const stop=async()=>{if(stopping)return;stopping=true;const timeout=setTimeout(()=>process.exit(0),8000);timeout.unref();await service.close();unlock();clearTimeout(timeout);};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);process.once('exit',()=>unlock?.());
}catch{unlock?.();process.exitCode=1;}
