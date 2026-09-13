import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { createWebHandler } from '../src/desktop-service.mjs';

test('desktop assets have no inline styles, handlers or dynamic style mutations', () => {
  const html = readFileSync(new URL('../desktop-ui/index.html', import.meta.url), 'utf8');
  const js = readFileSync(new URL('../desktop-ui/app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /\bstyle\s*=|<style\b|\bon\w+\s*=/i);
  assert.doesNotMatch(js, /\.style\b|\[\s*['"]style['"]\s*\]|setAttribute\(\s*['"]style['"]|\.cssText\b/);
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  assert.equal(scripts.length, 1);
  assert.match(scripts[0][1], /src="\/app.js"/); assert.equal(scripts[0][2].trim(), '');
});

test('actual HTTP asset response keeps strict CSP without unsafe-inline or unsafe-eval', async () => {
  const handler = createWebHandler({}, { origin: 'http://127.0.0.1:45678' }, () => {});
  const request = Readable.from([]);
  Object.assign(request, { method: 'GET', url: '/', headers: { host: '127.0.0.1:45678' } });
  const headers = {}; let status;
  await handler(request, {
    setHeader(name, value) { headers[name.toLowerCase()] = value; },
    writeHead(code) { status = code; }, end() {}
  });
  assert.equal(status, 200);
  const policy = headers['content-security-policy'];
  assert.match(policy, /default-src 'none'/);
  assert.match(policy, /(?:^|; )script-src 'self'(?:;|$)/);
  assert.match(policy, /(?:^|; )style-src 'self'(?:;|$)/);
  assert.match(policy, /frame-ancestors 'none'/);
  assert.doesNotMatch(policy, /unsafe-inline|unsafe-eval/);
});
