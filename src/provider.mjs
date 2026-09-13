import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { ReadError } from './core.mjs';
import { dataDirectory, noLinks, powershell, secureDirectory } from './local-security.mjs';
import { createNavigationRecovery } from './browser-navigation.mjs';

export { dataDirectory } from './local-security.mjs';
export function clearSessionMaintenance(directory = dataDirectory()) {
  const sessionDir = path.join(directory, 'session-maintenance');
  if (existsSync(sessionDir)) {
    noLinks(sessionDir);
    rmSync(sessionDir, { recursive: true, force: true });
  }
}
export function chromePath(env = process.env) {
  const candidates = [
    env.PROGRAMFILES && path.join(env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
    env['PROGRAMFILES(X86)'] && path.join(env['PROGRAMFILES(X86)'], 'Google/Chrome/Application/chrome.exe'),
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  return candidates.find(p => p && existsSync(p));
}
export function verifyChrome(binary) {
  noLinks(binary);
  if (process.platform === 'win32') powershell(`$ErrorActionPreference='Stop';
    $sig=Get-AuthenticodeSignature -LiteralPath $env:WA_CHROME_BINARY;
    if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch '(^|,\\s*)CN=Google (LLC|Inc)(,|$)') { throw 'Google Chrome signature not valid'; }`,
  { WA_CHROME_BINARY: binary });
}
export class WhatsAppProvider {
  constructor({ pairing = false, headless, onQr = () => {}, onReady = () => {}, onDisconnected = () => {} } = {}) {
    this.pairing = pairing; this.headless = headless ?? !pairing; this.onQr = onQr; this.onReady = onReady; this.onDisconnected = onDisconnected;
    this.state = 'not_started'; this.client = null; this.closed = false;
    this.navigationAbort = new AbortController();
  }
  status() { return { connected: this.state === 'ready', state: this.state, pairing_required: this.state === 'pairing_required' }; }
  accountId() { return this.client?.info?.wid?._serialized ?? null; }
  async start() {
    this.state = 'initializing';
    try {
      const executablePath = chromePath();
      if (!executablePath) throw new ReadError('CHROME_MISSING', 'Instale o Google Chrome na localização padrão.');
      verifyChrome(executablePath);
      const dataPath = secureDirectory(dataDirectory());
      const { default: wwebjs } = await import('whatsapp-web.js');
      if (this.closed) return;
      const authStrategy = new wwebjs.LocalAuth({ clientId: 'maintenance', dataPath });
      this.attachClient(new wwebjs.Client({
        deviceName: 'WhatsApp Manutencao 0.3.0',
        authStrategy,
        puppeteer: { headless: this.headless, executablePath },
        webVersionCache: { type: 'none' },
        qrMaxRetries: 5, takeoverOnConflict: false
      }));
      this.client.on('qr', qr => {
        if (this.closed) { void this.client.destroy().catch(() => {}); return; }
        this.state = 'pairing_required';
        if (this.pairing) this.onQr(qr);
        else void this.close(); // Pairing is available only in the local interactive command.
      });
      this.client.on('authenticated', () => { if (!this.closed) this.state = 'syncing'; });
      this.client.on('ready', async () => {
        if (this.closed) { void this.client.destroy().catch(() => {}); return; }
        await this.patchClient();
        if (this.closed) return;
        this.state = 'ready'; this.onReady();
      });
      this.client.on('auth_failure', () => { if (!this.closed) { this.state = 'authentication_failed'; this.onDisconnected(); } });
      this.client.on('disconnected', () => { if (!this.closed) { this.state = 'disconnected'; this.onDisconnected(); } });
      await this.client.initialize();
      if (this.closed) await this.client.destroy().catch(() => {});
    } catch (error) {
      if (this.closed) return;
      this.state = error.code === 'CHROME_MISSING' ? 'chrome_missing' : 'connection_error';
      // Do not put library error payloads, session paths or QR values in MCP logs.
      const failure = new ReadError('CONNECTION_FAILED', this.state === 'chrome_missing'
        ? 'Google Chrome não localizado. Instale o navegador e tente novamente.'
        : 'A conexão falhou. Feche outras instâncias do aplicativo e tente novamente.');
      // Preserve the original exception internally; public APIs use safe errors.
      failure.cause = error;
      throw failure;
    }
  }
  attachClient(client) {
    this.client = client;
    client.inject = createNavigationRecovery({
      getPage: () => client.pupPage,
      inject: client.inject.bind(client),
      signal: this.navigationAbort.signal
    });
  }
  async patchClient() {
    try {
      await this.client?.pupPage?.evaluate(() => {
        if (window.WWebJS && !window.WWebJS._patchedGetChatModel) {
          const orig = window.WWebJS.getChatModel;
          window.WWebJS.getChatModel = async (chat, options) => {
            try {
              return await orig(chat, options);
            } catch {
              if (!chat) return null;
              const model = chat.serialize ? chat.serialize() : { id: chat.id };
              model.isGroup = Boolean(chat.groupMetadata || (chat.id?._serialized?.endsWith('@g.us')));
              model.formattedTitle = chat.formattedTitle || chat.name;
              return model;
            }
          };
          window.WWebJS._patchedGetChatModel = true;
        }
      });
    } catch {}
  }
  async chats() {
    await this.patchClient();
    return this.client.getChats();
  }
  async chat(id) {
    await this.patchClient();
    return this.client.getChatById(id);
  }
  async messages(chat, limit) { return chat.fetchMessages({ limit }); }
  async logout() {
    if (this.client && this.state === 'ready') {
      try { await this.client.logout(); } catch {}
    }
    await this.close();
  }
  async close() {
    this.closed = true;
    this.navigationAbort.abort();
    const proc = this.client?.pupBrowser?.process();
    if (this.client) await this.client.destroy().catch(() => {});
    if (proc?.pid && proc.exitCode === null && proc.signalCode === null && !proc.killed) {
      // Use Puppeteer's own ChildProcess, never a process-name search or a stale
      // numeric PID passed to another process after browser.close().
      try { proc.kill('SIGKILL'); } catch {}
    }
    this.state = 'stopped';
  }
}
