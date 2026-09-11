import { minimalEnvironment } from '../src/local-security.mjs';
import net from 'node:net';
const safe=minimalEnvironment();for(const key of Object.keys(process.env))if(!(key in safe))delete process.env[key];
try {
  const {ensureRunning}=await import('../src/desktop-process.mjs');const d=await ensureRunning();
  const socket=net.connect(d.pipe);
  const deadline=setTimeout(()=>socket.destroy(),10000);deadline.unref();
  socket.once('connect',()=>{clearTimeout(deadline);socket.write(JSON.stringify({authenticate:d.ipc_token})+'\n');process.stdin.pipe(socket);socket.pipe(process.stdout);});
  socket.once('error',()=>{process.stderr.write('Conexão local indisponível. Abra WhatsApp Manutenção.\n');process.exitCode=1;});
  socket.once('close',()=>{clearTimeout(deadline);process.stdin.unpipe(socket);process.stdin.destroy();});
  process.once('SIGINT',()=>socket.destroy());process.once('SIGTERM',()=>socket.destroy());
}catch{process.stderr.write('Abra WhatsApp Manutenção e confira a conexão.\n');process.exitCode=1;}
