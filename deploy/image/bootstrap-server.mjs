import http from 'node:http';
import { randomBytes, verify as verifySignature } from 'node:crypto';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const DATA_DIR = process.env.WA_DATA_DIRECTORY || '/var/lib/whatsapp-manutencao';
const KEY_FILE = process.env.WA_BOOTSTRAP_PUBLIC_KEY || '/etc/whatsapp-manutencao/bootstrap-public-key.pem';
const PORT = Number(process.env.WA_BOOTSTRAP_PORT || 8788);
const APP_ORIGIN = process.env.WA_APP_ORIGIN || 'http://127.0.0.1:8787';
const DISABLED_FILE = path.join(DATA_DIR, 'bootstrap-disabled');
const publicKey = readFileSync(KEY_FILE, 'utf8');

if (existsSync(DISABLED_FILE)) {
  console.log('Bootstrap administrativo desabilitado.');
  process.exit(0);
}

const challenges = new Map();
const oneTimeTokens = new Map();
const sessions = new Map();
const attempts = new Map();
const now = () => Date.now();
const token = (n = 32) => randomBytes(n).toString('base64url');

function prune() {
  const t = now();
  for (const store of [challenges, oneTimeTokens, sessions]) {
    for (const [key, value] of store) if (value.expires <= t) store.delete(key);
  }
  for (const [key, value] of attempts) if (value.reset <= t) attempts.delete(key);
}
setInterval(prune, 30_000).unref();

function json(res, status, body, headers = {}) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers
  });
  res.end(data);
}

function text(res, status, body, type = 'text/plain; charset=utf-8', headers = {}) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

async function readJson(req, max = 32_768) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw new Error('Corpo excede o limite.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function clientKey(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
}

function rateLimit(req) {
  const key = clientKey(req);
  const t = now();
  let entry = attempts.get(key);
  if (!entry || entry.reset <= t) entry = { count: 0, reset: t + 60_000 };
  entry.count++;
  attempts.set(key, entry);
  return entry.count <= 12;
}

function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function sessionFor(req) {
  const sid = cookies(req).wa_bootstrap;
  const item = sid ? sessions.get(sid) : null;
  if (!item || item.expires <= now()) return null;
  item.expires = now() + 30 * 60_000;
  return { sid, ...item };
}

function adminToken() {
  const file = path.join(DATA_DIR, 'vps-admin.json');
  const data = JSON.parse(readFileSync(file, 'utf8'));
  if (!/^[a-f0-9]{64}$/.test(String(data.admin_token || ''))) throw new Error('Token administrativo indisponível.');
  return data.admin_token;
}

function gptToken() {
  const file = path.join(DATA_DIR, 'gpt-config.json');
  const data = JSON.parse(readFileSync(file, 'utf8'));
  if (!/^[a-f0-9]{64}$/.test(String(data.gpt_token || ''))) throw new Error('Token GPT indisponível.');
  return data.gpt_token;
}

async function appCall(route, method = 'GET', body) {
  const headers = { Authorization: `Bearer ${adminToken()}` };
  const init = { method, headers, cache: 'no-store' };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const response = await fetch(`${APP_ORIGIN}${route}`, init);
  const raw = await response.text();
  let parsed;
  try { parsed = JSON.parse(raw); } catch { parsed = { error: raw || `HTTP ${response.status}` }; }
  return { status: response.status, body: parsed };
}

const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WhatsApp Manutenção — Pareamento seguro</title><style>body{font-family:system-ui,sans-serif;margin:0;background:#f4f6f3;color:#1f2f27}main{max-width:850px;margin:30px auto;padding:24px;background:#fff;border-radius:16px}button{padding:9px 14px;margin:4px;border:0;border-radius:8px;cursor:pointer;background:#245f45;color:#fff}.secondary{background:#e5ece7;color:#1f2f27}.danger{background:#8c2f22}.card{border:1px solid #d8e2d6;border-radius:10px;padding:14px;margin:14px 0}.row{display:flex;gap:8px;flex-wrap:wrap}.chat{display:block;padding:6px}.muted{color:#607167;font-size:13px}#qr{max-width:320px}.hidden{display:none}#notice{white-space:pre-wrap;color:#8c2f22}</style></head><body><main><h1>WhatsApp Manutenção — Pareamento seguro</h1><p class="muted">Sessão temporária autenticada por assinatura criptográfica. O painel /admin permanece bloqueado publicamente.</p><div class="card"><strong>Status:</strong> <span id="phase">—</span> · <span id="conn">—</span><div class="row"><button id="pair">Parear / gerar QR</button><button id="reconnect" class="secondary">Reconectar</button><button id="edit" class="secondary">Editar autorizações</button><button id="block" class="danger">Bloquear acesso</button></div><p id="notice"></p></div><div id="qr-card" class="card hidden"><h2>QR code</h2><img id="qr" alt="QR code do WhatsApp"></div><div id="choices-card" class="card hidden"><h2>Conversas e permissões</h2><div><label><input id="s-send" type="checkbox"> Enviar mensagens</label> <label><input id="s-create" type="checkbox"> Criar grupos</label> <label><input id="s-manage" type="checkbox"> Gerir grupos/participantes</label></div><div id="choices"></div><button id="authorize">Salvar autorização</button></div></main><script src="/bootstrap/app.js" defer></script></body></html>`;

const js = `const $=id=>document.getElementById(id);function hidden(id,v){$(id).classList.toggle('hidden',v)}function note(v=''){$('notice').textContent=v}async function api(p,b){const i={credentials:'same-origin',cache:'no-store'};if(b!==undefined){i.method='POST';i.headers={'Content-Type':'application/json'};i.body=JSON.stringify(b)}const r=await fetch('/bootstrap/api/'+p,i),d=await r.json();if(!r.ok)throw new Error(d.error||'Falha');return d}function render(s){$('phase').textContent=s.phase;$('conn').textContent=s.connected?'conectado':'desconectado';hidden('qr-card',!s.qr_svg);if(s.qr_svg)$('qr').src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(s.qr_svg);hidden('choices-card',s.phase!=='choose');if(s.phase==='choose'){const box=$('choices');box.replaceChildren();for(const c of s.choices||[]){const l=document.createElement('label');l.className='chat';const x=document.createElement('input');x.type='checkbox';x.value=c.id;x.checked=!!c.authorized;l.append(x,document.createTextNode(' '+(c.name||c.id)+' ('+(c.group?'grupo':'contato')+')'));box.append(l)}const sc=new Set(s.scopes||['whatsapp.read']);$('s-send').checked=sc.has('whatsapp.send');$('s-create').checked=sc.has('whatsapp.group.create');$('s-manage').checked=sc.has('whatsapp.group.manage')}note(s.error||'')}async function refresh(){try{render(await api('status'))}catch(e){note(e.message)}}async function act(p,b={}){try{note('');await api(p,b);setTimeout(refresh,250)}catch(e){note(e.message)}}$('pair').onclick=()=>act('connect');$('reconnect').onclick=()=>act('reconnect');$('edit').onclick=()=>act('edit');$('block').onclick=()=>act('block');$('authorize').onclick=()=>{const scopes=['whatsapp.read'];if($('s-send').checked)scopes.push('whatsapp.send');if($('s-create').checked)scopes.push('whatsapp.group.create');if($('s-manage').checked)scopes.push('whatsapp.group.manage');const chat_ids=[...$('choices').querySelectorAll('input:checked')].map(x=>x.value);return act('authorize',{chat_ids,scopes})};void refresh();setInterval(refresh,1500);`;

const server = http.createServer(async (req, res) => {
  prune();
  let url;
  try { url = new URL(req.url, 'http://127.0.0.1'); } catch { return json(res, 400, { error: 'Solicitação inválida.' }); }

  if (url.pathname === '/bootstrap/healthz') return json(res, 200, { alive: true, finalized: existsSync(DISABLED_FILE) });

  if (req.method === 'GET' && url.pathname === '/bootstrap/challenge') {
    if (!rateLimit(req)) return json(res, 429, { error: 'Muitas tentativas.' });
    const challenge = token(32);
    challenges.set(challenge, { expires: now() + 5 * 60_000 });
    return json(res, 200, { challenge, algorithm: 'ed25519', expires_in: 300 });
  }

  if (req.method === 'POST' && url.pathname === '/bootstrap/verify') {
    if (!rateLimit(req)) return json(res, 429, { error: 'Muitas tentativas.' });
    try {
      const body = await readJson(req, 8_192);
      const challenge = String(body.challenge || '');
      const signature = String(body.signature || '');
      const item = challenges.get(challenge);
      challenges.delete(challenge);
      if (!item || item.expires <= now()) return json(res, 401, { error: 'Desafio expirado ou inválido.' });
      const sig = Buffer.from(signature, 'base64');
      if (sig.length !== 64 || !verifySignature(null, Buffer.from(challenge, 'utf8'), publicKey, sig)) {
        return json(res, 401, { error: 'Assinatura inválida.' });
      }
      const once = token(32);
      oneTimeTokens.set(once, { expires: now() + 10 * 60_000 });
      return json(res, 200, { session_path: `/bootstrap/session/${once}`, expires_in: 600 });
    } catch (error) {
      return json(res, 400, { error: error instanceof Error ? error.message : 'Falha de verificação.' });
    }
  }

  if (req.method === 'GET' && url.pathname.startsWith('/bootstrap/session/')) {
    const once = url.pathname.split('/').pop();
    const item = oneTimeTokens.get(once);
    oneTimeTokens.delete(once);
    if (!item || item.expires <= now()) return text(res, 401, 'Sessão expirada.');
    const sid = token(32);
    sessions.set(sid, { expires: now() + 30 * 60_000 });
    res.writeHead(302, {
      Location: '/bootstrap/admin',
      'Cache-Control': 'no-store',
      'Set-Cookie': `wa_bootstrap=${encodeURIComponent(sid)}; Path=/bootstrap; Max-Age=1800; HttpOnly; Secure; SameSite=Strict`
    });
    return res.end();
  }

  const session = sessionFor(req);
  if (!session) return json(res, 401, { error: 'Sessão de bootstrap não autenticada.' });

  if (req.method === 'GET' && (url.pathname === '/bootstrap' || url.pathname === '/bootstrap/admin')) return text(res, 200, html, 'text/html; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/bootstrap/app.js') return text(res, 200, js, 'application/javascript; charset=utf-8');

  if (url.pathname.startsWith('/bootstrap/api/')) {
    try {
      const op = url.pathname.slice('/bootstrap/api/'.length);
      const map = {
        status: ['/admin/status', 'GET'],
        connect: ['/admin/connect', 'POST'],
        reconnect: ['/admin/reconnect', 'POST'],
        edit: ['/admin/edit', 'POST'],
        block: ['/admin/block', 'POST'],
        authorize: ['/admin/authorize', 'POST']
      };
      if (op === 'gpt-token' && req.method === 'GET') return json(res, 200, { gpt_token: gptToken() });
      if (op === 'finalize' && req.method === 'POST') {
        writeFileSync(DISABLED_FILE, `${new Date().toISOString()}\n`, { mode: 0o600 });
        json(res, 200, { ok: true, bootstrap_disabled: true });
        setTimeout(() => process.exit(0), 750).unref();
        return;
      }
      const spec = map[op];
      if (!spec || req.method !== spec[1]) return json(res, 404, { error: 'Ação não encontrada.' });
      const body = req.method === 'POST' ? await readJson(req) : undefined;
      const result = await appCall(spec[0], spec[1], body);
      return json(res, result.status, result.body);
    } catch (error) {
      return json(res, 500, { error: error instanceof Error ? error.message : 'Falha no proxy administrativo.' });
    }
  }

  return json(res, 404, { error: 'Não encontrado.' });
});

server.listen(PORT, '127.0.0.1', () => console.log(`Bootstrap seguro em 127.0.0.1:${PORT}`));
