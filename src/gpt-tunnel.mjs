import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, createWriteStream, chmodSync } from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { dataDirectory, noLinks, readPrivateJson, secureDirectory, writePrivateJson } from './local-security.mjs';

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
  if (existsSync(binPath)) return binPath;

  const binDir = path.dirname(binPath);
  mkdirSync(binDir, { recursive: true, mode: 0o700 });

  const url = process.platform === 'win32'
    ? 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'
    : 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64';

  await new Promise((resolve, reject) => {
    function get(reqUrl) {
      https.get(reqUrl, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          get(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Falha ao baixar cloudflared: HTTP ${res.statusCode}`));
          return;
        }
        const file = createWriteStream(binPath, { mode: 0o700 });
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
        file.on('error', reject);
      }).on('error', reject);
    }
    get(url);
  });

  try { chmodSync(binPath, 0o700); } catch {}
  return binPath;
}

export async function startCloudflareTunnel({ localPort, directory = dataDirectory(), timeoutMs = 30000 }) {
  const bin = await ensureCloudflared(directory);
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ['tunnel', '--url', `http://127.0.0.1:${localPort}`], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let publicUrl = null;
    let resolved = false;

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        child.kill();
        reject(new Error('Tempo limite excedido ao conectar o túnel Cloudflare.'));
      }
    }, timeoutMs);

    function onData(chunk) {
      const text = chunk.toString();
      const match = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/.exec(text);
      if (match && !publicUrl) {
        publicUrl = match[0];
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          resolve({
            url: publicUrl,
            child,
            close() {
              try { child.kill(); } catch {}
            }
          });
        }
      }
    }

    child.stdout.on('data', onData);
    child.stderr.on('data', onData);

    child.once('error', err => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        reject(err);
      }
    });

    child.once('exit', code => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        reject(new Error(`Cloudflared encerrou inesperadamente com código ${code}`));
      }
    });
  });
}
