import { randomBytes, createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, createWriteStream, createReadStream, chmodSync, unlinkSync, renameSync } from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { dataDirectory, noLinks, readPrivateJson, secureDirectory, writePrivateJson } from './local-security.mjs';

export const CLOUDFLARED_VERSION = '2026.9.1';

export const CLOUDFLARED_CHECKSUMS = {
  'win32-x64': {
    filename: 'cloudflared-windows-amd64.exe',
    sha256: '2837888cc0f5d58f15b6dc478376de90b4d3ba5241c7947455d1e0a0df429712'
  },
  'linux-x64': {
    filename: 'cloudflared-linux-amd64',
    sha256: '03f1f25d1cc93b9ad6c60569d44060bc4f17ed97075760ed8cfca4b12dcd68cc'
  }
};

export function computeFileSha256(filePath) {
  return new Promise((resolve, reject) => {
    if (!existsSync(filePath)) {
      return reject(new Error('Arquivo não encontrado para cálculo de hash.'));
    }
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex').toLowerCase()));
    stream.on('error', reject);
  });
}

export function getOrCreateGptToken(directory = dataDirectory()) {
  secureDirectory(directory);
  const configFile = path.join(directory, 'gpt-config.json');
  noLinks(configFile);
  try {
    const data = readPrivateJson(configFile);
    if (typeof data.gpt_token === 'string' && /^[a-f0-9]{64}$/.test(data.gpt_token)) {
      return data.gpt_token;
    }
  } catch {}
  const token = randomBytes(32).toString('hex');
  writePrivateJson(configFile, {
    version: '0.3.0',
    created_at: new Date().toISOString(),
    gpt_token: token
  });
  return token;
}

export function cloudflaredBinaryPath(directory = dataDirectory()) {
  const binDir = path.join(directory, 'bin');
  return path.join(binDir, process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
}

export async function ensureCloudflared(directory = dataDirectory()) {
  secureDirectory(directory);
  const binPath = cloudflaredBinaryPath(directory);
  const platformKey = `${process.platform}-${process.arch}`;
  const spec = CLOUDFLARED_CHECKSUMS[platformKey];

  if (!spec) {
    throw new Error(`Plataforma/arquitetura não suportada para túnel automático: ${platformKey}`);
  }

  // Verifica se o binário já existe e é 100% íntegro
  if (existsSync(binPath)) {
    try {
      const currentHash = await computeFileSha256(binPath);
      if (currentHash === spec.sha256) {
        return binPath;
      }
      // Hash divergente ou arquivo corrompido: descarta e baixa novamente
      unlinkSync(binPath);
    } catch {
      try { unlinkSync(binPath); } catch {}
    }
  }

  const binDir = path.dirname(binPath);
  mkdirSync(binDir, { recursive: true, mode: 0o700 });

  const downloadUrl = `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/${spec.filename}`;
  const tempPath = path.join(binDir, `.cf-download-${randomUUID()}.tmp`);

  await new Promise((resolve, reject) => {
    let redirects = 0;
    function download(currentUrl) {
      const parsed = new URL(currentUrl);
      if (parsed.protocol !== 'https:') {
        return reject(new Error('Download permitido apenas através de HTTPS.'));
      }
      const req = https.get(currentUrl, { timeout: 30000, headers: { 'User-Agent': 'WhatsApp-Manutencao/0.3.0' } }, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          redirects++;
          if (redirects > 5) {
            return reject(new Error('Muitos redirecionamentos ao baixar cloudflared.'));
          }
          download(new URL(res.headers.location, currentUrl).href);
          return;
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`Falha no download do cloudflared: HTTP ${res.statusCode}`));
        }

        const file = createWriteStream(tempPath, { mode: 0o700 });
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
        file.on('error', err => {
          try { unlinkSync(tempPath); } catch {}
          reject(err);
        });
      });
      req.on('error', err => {
        try { unlinkSync(tempPath); } catch {}
        reject(err);
      });
      req.on('timeout', () => {
        req.destroy();
        try { unlinkSync(tempPath); } catch {}
        reject(new Error('Tempo limite excedido ao baixar cloudflared.'));
      });
    }
    download(downloadUrl);
  });

  // Validação criptográfica de integridade do arquivo baixado
  const downloadedHash = await computeFileSha256(tempPath);
  if (downloadedHash !== spec.sha256) {
    try { unlinkSync(tempPath); } catch {}
    throw new Error(`Integridade do cloudflared violada! Esperado: ${spec.sha256}, obtido: ${downloadedHash}`);
  }

  try { chmodSync(tempPath, 0o700); } catch {}
  renameSync(tempPath, binPath);
  return binPath;
}

export class CloudflareTunnelManager {
  constructor({ directory = dataDirectory() } = {}) {
    this.directory = directory;
    this.child = null;
    this.url = null;
    this.active = false;
    this.starting = false;
    this.onUrlChange = null;
    this.onClose = null;
  }

  async start({ localPort, timeoutMs = 30000 } = {}) {
    if (this.active && this.url) return { url: this.url };
    if (this.starting) throw new Error('O túnel já está iniciando.');
    this.starting = true;

    try {
      const bin = await ensureCloudflared(this.directory);
      return await new Promise((resolve, reject) => {
        const child = spawn(bin, ['tunnel', '--url', `http://127.0.0.1:${localPort}`], {
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe']
        });

        this.child = child;
        let resolved = false;

        const timer = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            this.stop();
            reject(new Error('Tempo limite excedido ao conectar o túnel Cloudflare.'));
          }
        }, timeoutMs);

        const onData = chunk => {
          const text = chunk.toString();
          const match = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/.exec(text);
          if (match && !this.url) {
            this.url = match[0];
            this.active = true;
            this.starting = false;
            if (!resolved) {
              resolved = true;
              clearTimeout(timer);
              this.onUrlChange?.(this.url);
              resolve({ url: this.url });
            }
          }
        };

        child.stdout.on('data', onData);
        child.stderr.on('data', onData);

        child.once('error', err => {
          this.active = false;
          this.url = null;
          this.starting = false;
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            reject(err);
          }
          this.onClose?.(err);
        });

        child.once('exit', code => {
          this.active = false;
          this.url = null;
          this.starting = false;
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            reject(new Error(`Cloudflared encerrou inesperadamente com código ${code}`));
          }
          this.onClose?.(new Error(`Túnel encerrado com código ${code}`));
        });
      });
    } catch (err) {
      this.starting = false;
      this.active = false;
      this.url = null;
      throw err;
    }
  }

  stop() {
    this.active = false;
    this.starting = false;
    this.url = null;
    if (this.child) {
      try { this.child.kill(); } catch {}
      this.child = null;
    }
  }

  status() {
    return {
      active: this.active,
      url: this.url,
      starting: this.starting
    };
  }
}

export async function startCloudflareTunnel({ localPort, directory = dataDirectory(), timeoutMs = 30000 }) {
  const manager = new CloudflareTunnelManager({ directory });
  const { url } = await manager.start({ localPort, timeoutMs });
  return {
    url,
    child: manager.child,
    close() { manager.stop(); }
  };
}
