import { minimalEnvironment } from '../src/local-security.mjs';
const safe=minimalEnvironment();for(const key of Object.keys(process.env))if(!(key in safe))delete process.env[key];
try {
  const d=await (await import('../src/desktop-process.mjs')).ensureRunning();
  process.stdout.write(JSON.stringify({url:d.origin+'/#'+d.ui_token}));
}catch{process.stderr.write('Não foi possível abrir o aplicativo local.\n');process.exitCode=1;}
