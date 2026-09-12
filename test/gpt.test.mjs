import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { buildOpenApiSpec, createGptHandler } from '../src/gpt-handler.mjs';
import { getOrCreateGptToken } from '../src/gpt-tunnel.mjs';
import { Reader } from '../src/core.mjs';
import { AccessStore, savePolicy } from '../src/access.mjs';
import { fixtures, ACCOUNT, GROUP } from './fixtures.mjs';

function createMockResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    writeHead(code, headers = {}) {
      this.statusCode = code;
      this.headers = { ...this.headers, ...headers };
    },
    setHeader(key, val) {
      this.headers[key.toLowerCase()] = val;
    },
    end(data = '') {
      this.body = data;
    },
    json() {
      return JSON.parse(this.body || '{}');
    }
  };
}

function createMockRequest({ method = 'GET', url = '/gpt/status', headers = {}, body = null }) {
  const asyncIterable = {
    async *[Symbol.asyncIterator]() {
      if (body) {
        yield Buffer.from(body);
      }
    }
  };
  return Object.assign(asyncIterable, {
    method,
    url,
    headers: {
      host: '127.0.0.1',
      ...headers
    }
  });
}

function setupTestEnvironment(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'wa-gpt-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const accessFile = path.join(directory, 'access.json');
  savePolicy(ACCOUNT, [GROUP], accessFile);
  const access = new AccessStore(accessFile);
  const provider = fixtures();
  const reader = new Reader(provider, { access, cooldownMs: 0 });
  const gptToken = getOrCreateGptToken(directory);
  const handler = createGptHandler({
    getReader: () => reader,
    getGptToken: () => gptToken,
    getPublicUrl: () => 'https://test-tunnel.trycloudflare.com'
  });
  return { directory, access, provider, reader, gptToken, handler };
}

test('buildOpenApiSpec retorna especificação OpenAPI 3.1.0 válida', () => {
  const spec = buildOpenApiSpec('https://meu-tunnel.trycloudflare.com');
  assert.equal(spec.openapi, '3.1.0');
  assert.equal(spec.servers[0].url, 'https://meu-tunnel.trycloudflare.com');
  assert.ok(spec.paths['/gpt/status']);
  assert.ok(spec.paths['/gpt/chats']);
  assert.ok(spec.paths['/gpt/messages']);
  assert.ok(spec.paths['/gpt/search']);
  assert.ok(spec.components.securitySchemes.BearerAuth);
});

test('getOrCreateGptToken gera e persiste token de 64 caracteres hex', t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'wa-token-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const token1 = getOrCreateGptToken(directory);
  assert.match(token1, /^[a-f0-9]{64}$/);
  const token2 = getOrCreateGptToken(directory);
  assert.equal(token1, token2);
});

test('requisições OPTIONS preflight retornam 204 com cabeçalhos CORS', async t => {
  const { handler } = setupTestEnvironment(t);
  const req = createMockRequest({ method: 'OPTIONS', url: '/gpt/messages' });
  const res = createMockResponse();
  const url = new URL('http://127.0.0.1/gpt/messages');
  const handled = await handler(req, res, url);
  assert.equal(handled, true);
  assert.equal(res.statusCode, 204);
  assert.equal(res.headers['Access-Control-Allow-Origin'], '*');
  assert.ok(res.headers['Access-Control-Allow-Methods'].includes('POST'));
});

test('GET /gpt/openapi.json retorna o documento OpenAPI sem exigir autenticação', async t => {
  const { handler } = setupTestEnvironment(t);
  const req = createMockRequest({ method: 'GET', url: '/gpt/openapi.json' });
  const res = createMockResponse();
  const url = new URL('http://127.0.0.1/gpt/openapi.json');
  const handled = await handler(req, res, url);
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  const doc = res.json();
  assert.equal(doc.openapi, '3.1.0');
  assert.equal(doc.servers[0].url, 'https://test-tunnel.trycloudflare.com');
});

test('requisições sem Bearer token retornam 401 Unauthorized', async t => {
  const { handler } = setupTestEnvironment(t);
  const req = createMockRequest({ method: 'GET', url: '/gpt/status' });
  const res = createMockResponse();
  const url = new URL('http://127.0.0.1/gpt/status');
  await handler(req, res, url);
  assert.equal(res.statusCode, 401);
  assert.equal(res.json().code, 'UNAUTHORIZED');
});

test('requisições com Bearer token incorreto retornam 401 Unauthorized', async t => {
  const { handler } = setupTestEnvironment(t);
  const badToken = 'a'.repeat(64);
  const req = createMockRequest({
    method: 'GET',
    url: '/gpt/status',
    headers: { authorization: `Bearer ${badToken}` }
  });
  const res = createMockResponse();
  const url = new URL('http://127.0.0.1/gpt/status');
  await handler(req, res, url);
  assert.equal(res.statusCode, 401);
  assert.equal(res.json().code, 'UNAUTHORIZED');
});

test('GET /gpt/status com token válido retorna status do WhatsApp', async t => {
  const { handler, gptToken } = setupTestEnvironment(t);
  const req = createMockRequest({
    method: 'GET',
    url: '/gpt/status',
    headers: { authorization: `Bearer ${gptToken}` }
  });
  const res = createMockResponse();
  const url = new URL('http://127.0.0.1/gpt/status');
  await handler(req, res, url);
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.connected, true);
  assert.equal(body.read_only, true);
  assert.equal(body.allowed_chat_count, 1);
});

test('GET /gpt/chats com token válido retorna conversas autorizadas', async t => {
  const { handler, gptToken } = setupTestEnvironment(t);
  const req = createMockRequest({
    method: 'GET',
    url: '/gpt/chats',
    headers: { authorization: `Bearer ${gptToken}` }
  });
  const res = createMockResponse();
  const url = new URL('http://127.0.0.1/gpt/chats');
  await handler(req, res, url);
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(Array.isArray(body.chats), true);
  assert.equal(body.chats.length, 1);
  assert.equal(body.chats[0].chat_id, GROUP);
});

test('POST /gpt/messages valida chat_id obrigatório', async t => {
  const { handler, gptToken } = setupTestEnvironment(t);
  const req = createMockRequest({
    method: 'POST',
    url: '/gpt/messages',
    headers: {
      authorization: `Bearer ${gptToken}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ limit: 10 })
  });
  const res = createMockResponse();
  const url = new URL('http://127.0.0.1/gpt/messages');
  await handler(req, res, url);
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().code, 'INVALID_ARGUMENT');
});

test('POST /gpt/messages para conversa não autorizada retorna 403', async t => {
  const { handler, gptToken } = setupTestEnvironment(t);
  const req = createMockRequest({
    method: 'POST',
    url: '/gpt/messages',
    headers: {
      authorization: `Bearer ${gptToken}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ chat_id: '551199999999@c.us' })
  });
  const res = createMockResponse();
  const url = new URL('http://127.0.0.1/gpt/messages');
  await handler(req, res, url);
  assert.equal(res.statusCode, 403);
});

test('POST /gpt/messages para conversa autorizada retorna mensagens', async t => {
  const { handler, gptToken } = setupTestEnvironment(t);
  const req = createMockRequest({
    method: 'POST',
    url: '/gpt/messages',
    headers: {
      authorization: `Bearer ${gptToken}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ chat_id: GROUP, limit: 5 })
  });
  const res = createMockResponse();
  const url = new URL('http://127.0.0.1/gpt/messages');
  await handler(req, res, url);
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.chat_id, GROUP);
  assert.equal(Array.isArray(body.messages), true);
});

test('POST /gpt/search valida tamanho mínimo da consulta', async t => {
  const { handler, gptToken } = setupTestEnvironment(t);
  const req = createMockRequest({
    method: 'POST',
    url: '/gpt/search',
    headers: {
      authorization: `Bearer ${gptToken}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ query: 'a' })
  });
  const res = createMockResponse();
  const url = new URL('http://127.0.0.1/gpt/search');
  await handler(req, res, url);
  assert.equal(res.statusCode, 400);
});

test('POST /gpt/search com termo válido retorna resultados', async t => {
  const { handler, gptToken } = setupTestEnvironment(t);
  const req = createMockRequest({
    method: 'POST',
    url: '/gpt/search',
    headers: {
      authorization: `Bearer ${gptToken}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ query: 'manutencao' })
  });
  const res = createMockResponse();
  const url = new URL('http://127.0.0.1/gpt/search');
  await handler(req, res, url);
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(Array.isArray(body.results), true);
});

test('requisição com corpo superior a 16 KB é rejeitada com 400', async t => {
  const { handler, gptToken } = setupTestEnvironment(t);
  const bigPayload = JSON.stringify({
    chat_id: GROUP,
    padding: 'x'.repeat(20000)
  });
  const req = createMockRequest({
    method: 'POST',
    url: '/gpt/messages',
    headers: {
      authorization: `Bearer ${gptToken}`,
      'content-type': 'application/json'
    },
    body: bigPayload
  });
  const res = createMockResponse();
  const url = new URL('http://127.0.0.1/gpt/messages');
  await handler(req, res, url);
  assert.equal(res.statusCode, 400);
  assert.ok(res.json().error.includes('excede o limite'));
});

test('requisição com JSON malformado é rejeitada com 400', async t => {
  const { handler, gptToken } = setupTestEnvironment(t);
  const req = createMockRequest({
    method: 'POST',
    url: '/gpt/messages',
    headers: {
      authorization: `Bearer ${gptToken}`,
      'content-type': 'application/json'
    },
    body: '{chat_id: incompleted'
  });
  const res = createMockResponse();
  const url = new URL('http://127.0.0.1/gpt/messages');
  await handler(req, res, url);
  assert.equal(res.statusCode, 400);
  assert.ok(res.json().error.includes('Formato JSON inválido'));
});
