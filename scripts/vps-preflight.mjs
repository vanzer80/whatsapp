import { existsSync, readFileSync, statSync, statfsSync } from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromePath } from '../src/provider.mjs';
import { normalizePublicBase } from '../src/vps-service.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const staticOnly=process.argv.includes('--static');
const failures=[];const notes=[];
const ok=(name,condition,detail='')=>{if(condition)notes.push(`OK   ${name}${detail?`: ${detail}`:''}`);else failures.push(`FAIL ${name}${detail?`: ${detail}`:''}`);};
const text=file=>readFileSync(path.join(root,file),'utf8');

const [major,minor]=process.versions.node.split('.').map(Number);
ok('Node >= 22.12',major>22||(major===22&&minor>=12),process.version);
for(const file of ['package-lock.json','scripts/vps-service.mjs','src/vps-service.mjs','src/write-hardening.mjs','deploy/systemd/whatsapp-manutencao.service','deploy/caddy/Caddyfile.example','deploy/env.example'])
  ok(`arquivo ${file}`,existsSync(path.join(root,file)));
const vps=text('src/vps-service.mjs');
ok('bind somente loopback',/server\.listen\(port,'127\.0\.0\.1'/.test(vps));
const caddy=text('deploy/caddy/Caddyfile.example');
ok('Caddy publica health/GPT',/@public path \/health \/gpt\/\*/.test(caddy));
ok('Caddy não publica admin',!/@public[^\n]*admin/.test(caddy)&&/respond 404/.test(caddy));
const unit=text('deploy/systemd/whatsapp-manutencao.service');
ok('systemd usuário dedicado',/User=whatsapp-maint/.test(unit)&&/Group=whatsapp-maint/.test(unit));
ok('systemd sem privilégios novos',/NoNewPrivileges=true/.test(unit)&&/CapabilityBoundingSet=\s*$/m.test(unit));
ok('systemd escrita restrita',/ReadWritePaths=\/var\/lib\/whatsapp-manutencao/.test(unit));
const ignored=text('.gitignore');
for(const name of ['write-idempotency.json','write-rate.json','write-audit.jsonl','vps-admin.json','gpt-config.json'])
  ok(`estado privado ignorado: ${name}`,ignored.includes(name));

if(!staticOnly){
  ok('plataforma Linux',process.platform==='linux',process.platform);
  const chrome=chromePath();ok('Chrome/Chromium localizado',Boolean(chrome),chrome||'ausente');
  if(chrome){
    const probe=spawnSync(chrome,['--headless=new','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--dump-dom','about:blank'],{encoding:'utf8',timeout:20000});
    ok('Chrome headless inicia com sandbox',probe.status===0,probe.status===0?'ok':String(probe.stderr||probe.error?.message||'falha').slice(0,160));
  }
  const dataDir=path.resolve(process.env.WA_DATA_DIRECTORY||'/var/lib/whatsapp-manutencao');
  ok('diretório de dados existe',existsSync(dataDir),dataDir);
  if(existsSync(dataDir)){
    const mode=statSync(dataDir).mode&0o777;ok('diretório de dados restrito',mode===0o700,`mode ${mode.toString(8)}`);
    const fs=statfsSync(dataDir);const free=Number(fs.bavail)*Number(fs.bsize);
    ok('espaço livre >= 1 GiB',free>=1024**3,`${(free/1024**3).toFixed(1)} GiB`);
  }
  const publicBase=process.env.WA_PUBLIC_BASE_URL||'';
  try{normalizePublicBase(publicBase);ok('WA_PUBLIC_BASE_URL HTTPS',Boolean(publicBase),publicBase||'ausente');}
  catch(error){ok('WA_PUBLIC_BASE_URL HTTPS',false,error.message);}
  const port=Number(process.env.WA_PORT||8787);
  await new Promise(resolve=>{
    const probe=net.createServer();
    probe.once('error',error=>{ok(`porta ${port} livre em loopback`,false,error.code||error.message);resolve();});
    probe.listen(port,'127.0.0.1',()=>probe.close(()=>{ok(`porta ${port} livre em loopback`,true);resolve();}));
  });
}

for(const line of notes)console.log(line);
for(const line of failures)console.error(line);
if(failures.length){console.error(`Preflight reprovado: ${failures.length} item(ns).`);process.exitCode=1;}
else console.log(`Preflight aprovado (${staticOnly?'estático':'runtime'}).`);
