import { minimalEnvironment } from '../src/local-security.mjs';
import net from 'node:net';
const safe = minimalEnvironment();
const winSys = new Set([
  'systemdrive', 'userdomain', 'username', 'computername', 'pathext', 'path',
  'programdata', 'allusersprofile', 'os', 'processor_architecture', 'psmodulepath',
  'commonprogramfiles', 'commonprogramfiles(x86)', 'commonprogramw6432'
]);
for (const key of Object.keys(process.env)) {
  const lower = key.toLowerCase();
  if (!(key in safe) && !winSys.has(lower)) {
    delete process.env[key];
  }
}
if (process.platform === 'win32') {
  const sysRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
  process.env.PATH = `${sysRoot}\\System32;${sysRoot};${sysRoot}\\System32\\WindowsPowerShell\\v1.0`;
  if (!process.env.SystemDrive) process.env.SystemDrive = sysRoot.slice(0, 2);
}
try {
  const {ensureRunning}=await import('../src/desktop-process.mjs');const d=await ensureRunning();
  const socket=net.connect(d.pipe);
  const deadline=setTimeout(()=>socket.destroy(),10000);deadline.unref();
  socket.once('connect',()=>{clearTimeout(deadline);socket.write(JSON.stringify({authenticate:d.ipc_token})+'\n');process.stdin.pipe(socket);socket.pipe(process.stdout);});
  socket.once('error',()=>{process.stderr.write('Conexão local indisponível. Abra WhatsApp Manutenção.\n');process.exitCode=1;});
  socket.once('close',()=>{clearTimeout(deadline);process.stdin.unpipe(socket);process.stdin.destroy();});
  process.once('SIGINT',()=>socket.destroy());process.once('SIGTERM',()=>socket.destroy());
}catch{process.stderr.write('Abra WhatsApp Manutenção e confira a conexão.\n');process.exitCode=1;}
