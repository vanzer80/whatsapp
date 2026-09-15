import path from 'node:path';
import { readPrivateJson } from '../src/local-security.mjs';

const directory = path.resolve(process.env.WA_DATA_DIRECTORY || '/var/lib/whatsapp-manutencao');
const port = Number(process.env.WA_PORT || 8787);
const origin = `http://127.0.0.1:${port}`;
const action = process.argv[2] || 'status';

if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('WA_PORT inválida.');
if (!['connect', 'status', 'qr'].includes(action)) throw new Error('Ação inválida. Use connect, status ou qr.');

const { admin_token: adminToken } = readPrivateJson(path.join(directory, 'vps-admin.json'));
if (typeof adminToken !== 'string' || !/^[a-f0-9]{64}$/.test(adminToken)) throw new Error('Token administrativo inválido.');

const adminFetch = async (pathname, init = {}) => fetch(`${origin}${pathname}`, {
  ...init,
  headers: { ...(init.headers || {}), Authorization: `Bearer ${adminToken}` },
});

const status = async () => {
  const response = await adminFetch('/admin/status');
  if (!response.ok) throw new Error(`Status administrativo falhou: HTTP ${response.status}`);
  return response.json();
};

const connect = async () => {
  const response = await adminFetch('/admin/connect', { method: 'POST' });
  if (!response.ok) throw new Error(`Conexão administrativa falhou: HTTP ${response.status}`);
  console.log('Pareamento solicitado com sucesso.');
};

function renderQrSvg(svg) {
  const view = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
  if (!view) throw new Error('QR SVG inválido.');
  const width = Number(view[1]), height = Number(view[2]);
  const dark = new Set();
  for (const match of svg.matchAll(/M(\d+) (\d+)h1v1h-1z/g)) dark.add(`${match[1]},${match[2]}`);
  if (!dark.size) throw new Error('QR SVG sem módulos.');
  const black = '\x1b[40m  \x1b[0m';
  const white = '\x1b[47m  \x1b[0m';
  for (let y = 0; y < height; y++) {
    let line = '';
    for (let x = 0; x < width; x++) line += dark.has(`${x},${y}`) ? black : white;
    console.log(line);
  }
}

if (action === 'connect') {
  await connect();
} else if (action === 'status') {
  const state = await status();
  console.log(JSON.stringify({ phase: state.phase, connected: state.connected, browser_available: state.browser_available, allowed_count: state.allowed_count, qr_ready: Boolean(state.qr_svg), error: state.error || null }));
} else {
  const deadline = Date.now() + 120000;
  let state;
  while (Date.now() < deadline) {
    state = await status();
    if (state.qr_svg) break;
    if (state.phase === 'error' && state.error) throw new Error(state.error);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (!state?.qr_svg) throw new Error('QR não foi gerado dentro do prazo.');
  console.log('QR_WHATSAPP_MANUTENCAO');
  renderQrSvg(state.qr_svg);
  console.log('ESCANEIE AGORA PELO WHATSAPP > APARELHOS CONECTADOS > CONECTAR APARELHO');
}
