import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=file=>readFileSync(path.join(root,file),'utf8');

test('workflow Linux usa Ubuntu 24.04 e executa testes + preflight',()=>{
  const yaml=read('.github/workflows/linux-vps-ci.yml');
  assert.match(yaml,/runs-on: ubuntu-24\.04/);
  assert.match(yaml,/run: npm ci/);
  assert.match(yaml,/run: npm test/);
  assert.match(yaml,/npm run preflight:vps:static/);
});

test('systemd executa como usuário dedicado com filesystem restrito',()=>{
  const unit=read('deploy/systemd/whatsapp-manutencao.service');
  assert.match(unit,/User=whatsapp-maint/);assert.match(unit,/Group=whatsapp-maint/);
  assert.match(unit,/NoNewPrivileges=true/);assert.match(unit,/ProtectSystem=strict/);
  assert.match(unit,/ReadWritePaths=\/var\/lib\/whatsapp-manutencao/);
});
test('Caddy publica somente health/GPT e bloqueia painel administrativo',()=>{
  const caddy=read('deploy/caddy/Caddyfile.example');
  assert.match(caddy,/route \{/);
  assert.match(caddy,/@public path \/health \/gpt\/\*/);
  assert.doesNotMatch(caddy,/@public[^\n]*\/admin/);
  assert.ok(caddy.indexOf('reverse_proxy @public') < caddy.indexOf('respond 404'));

});

test('preflight estático do pacote é aprovado',()=>{
  const result=spawnSync(process.execPath,['scripts/vps-preflight.mjs','--static'],{cwd:root,encoding:'utf8'});
  assert.equal(result.status,0,`${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout,/Preflight aprovado \(estático\)/);
});

test('env de exemplo não contém segredo e exige origem HTTPS',()=>{
  const env=read('deploy/env.example');
  assert.match(env,/WA_PUBLIC_BASE_URL=https:\/\//);
  assert.doesNotMatch(env,/(TOKEN|SECRET|PASSWORD|API_KEY)=\S+/i);
});
