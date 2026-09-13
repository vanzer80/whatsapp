// All pages and accounts in this suite are synthetic and confined to loopback.
// This never opens WhatsApp Web, a user profile, a tunnel or the ChatGPT config.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import puppeteer from 'puppeteer';
import { chromePath } from '../src/provider.mjs';
import { createNavigationRecovery, isNavigationContextDestroyed } from '../src/browser-navigation.mjs';
import { createWebHandler } from '../src/desktop-service.mjs';

let browser, server, origin;
const connection = { uiToken: 'a'.repeat(64), origin: '', registered: false };
const state = { phase: 'welcome', browser_available: true, allowed_count: 0, connected: false, qr_svg: null };
const handler = createWebHandler({ status: () => state, choices: [] }, connection, () => {});
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

before(async () => {
  server = http.createServer((req, res) => {
    if (req.url.startsWith('/fixture')) {
      res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
      res.end(req.url === '/fixture-wait' ? '<!doctype html><p>Waiting fixture</p>' :
        '<!doctype html><script>window.Debug={VERSION:"synthetic"}</script><p>Ready fixture</p>');
    } else void handler(req, res);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  origin = `http://127.0.0.1:${server.address().port}`; connection.origin = origin;
  browser = await puppeteer.launch({ headless: true, executablePath: chromePath() || puppeteer.executablePath() });
});
after(async () => {
  await browser?.close();
  if (server?.listening) await new Promise(resolve => server.close(resolve));
});
async function pageFor(t, route = '/fixture-ready') {
  const page = await browser.newPage(); t.after(() => page.close());
  await page.goto(origin + route); return page;
}

test('real Chromium navigation destroys an active evaluation and recovery injects in the new document', async t => {
  const page = await pageFor(t), entered = deferred();
  let injections = 0, destroyed = false;
  const recover = createNavigationRecovery({ getPage: () => page, inject: async () => {
    if (++injections === 1) {
      const evaluation = page.evaluate(() => { window.fixtureEvaluating = true; return new Promise(() => {}); });
      entered.resolve();
      try { return await evaluation; } catch (error) { destroyed = isNavigationContextDestroyed(error); throw error; }
    }
    return page.evaluate(() => window.Debug.VERSION);
  } });
  const pending = recover(); await entered.promise;
  const handle = await page.waitForFunction(() => window.fixtureEvaluating); await handle.dispose();
  await page.goto(origin + '/fixture-next');
  assert.equal(await pending, 'synthetic');
  assert.equal(destroyed, true); assert.equal(injections, 2);
  assert.equal(await recover(), 'synthetic'); assert.equal(injections, 3);
});

test('real waitForFunction survives navigation while the old document is not ready', async t => {
  const page = await pageFor(t, '/fixture-wait'), entered = deferred();
  const wait = page.waitForFunction.bind(page);
  let injected = 0;
  const recover = createNavigationRecovery({ getPage: () => ({ waitForFunction(...args) {
    const pending = wait(...args); entered.resolve(); return pending;
  } }), inject: async () => { injected++; return page.evaluate(() => window.Debug.VERSION); } });
  const pending = recover(); await entered.promise;
  await page.goto(origin + '/fixture-ready');
  assert.equal(await pending, 'synthetic'); assert.equal(injected, 1);
});

test('real Puppeteer wait cancels without injecting or leaving a rejected navigation listener', async t => {
  const page = await pageFor(t, '/fixture-wait'), controller = new AbortController();
  let injected = 0;
  const recover = createNavigationRecovery({ getPage: () => page, signal: controller.signal,
    inject: async () => { injected++; } });
  const pending = recover(); controller.abort(); await pending;
  await page.goto(origin + '/fixture-ready'); await recover();
  assert.equal(injected, 0);
});

test('real desktop UI has no CSP violations through pairing and dynamic status changes', async t => {
  const page = await browser.newPage(); t.after(() => page.close());
  let pageErrors = 0; page.on('pageerror', () => { pageErrors++; });
  await page.evaluateOnNewDocument(() => {
    sessionStorage.setItem('wa-local-token', 'a'.repeat(64));
    window.fixtureCspViolations = [];
    addEventListener('securitypolicyviolation', event => window.fixtureCspViolations.push(event.effectiveDirective));
  });
  await page.goto(origin + '/');
  const ready = await page.waitForFunction(() => typeof refresh === 'function'); await ready.dispose();
  for (const phase of ['welcome', 'connecting', 'pairing', 'choose', 'ready', 'blocked', 'error']) {
    state.phase = phase;
    state.qr_svg = phase === 'pairing' ? '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10v10H0z"/></svg>' : null;
    await page.evaluate(() => refresh());
    assert.equal(await page.$eval(`#${phase}`, element => element.hidden), false);
  }
  state.phase = 'ready'; state.connected = true; state.allowed_count = 1;
  connection.publicUrl = 'https://synthetic.example'; connection.externalQueryConfirmed = true;
  await page.evaluate(() => refresh());
  assert.equal(await page.$eval('#st-wa-dot', e => getComputedStyle(e).backgroundColor), 'rgb(50, 140, 98)');
  assert.equal(await page.$eval('#toggle-tunnel', e => getComputedStyle(e).marginTop), '0px');
  assert.equal(await page.$eval('#toggle-tunnel', e => e.classList.contains('secondary')), true);
  state.connected = false; state.allowed_count = 0;
  connection.publicUrl = null; connection.externalQueryConfirmed = false;
  await page.evaluate(() => refresh());
  assert.equal(await page.$eval('#st-wa-dot', e => getComputedStyle(e).backgroundColor), 'rgb(201, 74, 41)');
  assert.equal(await page.$eval('#st-auth-dot', e => getComputedStyle(e).backgroundColor), 'rgb(170, 170, 170)');
  assert.equal(await page.$$eval('[style]', elements => elements.length), 0);
  assert.deepEqual(await page.evaluate(() => window.fixtureCspViolations), []);
  assert.equal(pageErrors, 0);
});
