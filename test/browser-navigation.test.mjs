import test from 'node:test';
import assert from 'node:assert/strict';
import { createNavigationRecovery, isNavigationContextDestroyed } from '../src/browser-navigation.mjs';
import { WhatsAppProvider } from '../src/provider.mjs';

const navigationError = () => new Error('Execution context was destroyed, most likely because of a navigation.');
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(options = {}) {
  const stats = { waits: 0, injections: 0, disposed: 0, budgets: [] };
  const page = { async waitForFunction(predicate, config) {
    stats.waits++; stats.budgets.push(config.timeout);
    assert.ok(config.signal instanceof AbortSignal);
    assert.match(predicate.toString(), /document.readyState/);
    assert.match(predicate.toString(), /window.Debug/);
    return { async dispose() { stats.disposed++; } };
  } };
  const recover = createNavigationRecovery({ getPage: () => page, inject: async () => {
    stats.injections++;
    assert.equal(stats.disposed, stats.waits, 'readiness handles are disposed before injection');
    return 'injected';
  }, ...options });
  return { recover, page, stats };
}

test('recovers an injection after execution context destruction', async () => {
  let injections = 0;
  const { recover, stats } = fixture({ inject: async () => {
    if (++injections === 1) throw navigationError();
    return 'recovered';
  } });
  assert.equal(await recover(), 'recovered');
  assert.equal(injections, 2); assert.equal(stats.disposed, 2);
});

test('navigation during waitForFunction retries readiness before injection', async () => {
  const { recover, page, stats } = fixture();
  const wait = page.waitForFunction.bind(page);
  let calls = 0;
  page.waitForFunction = async (...args) => {
    if (++calls === 1) throw navigationError();
    return wait(...args);
  };
  assert.equal(await recover(), 'injected');
  assert.equal(calls, 2); assert.equal(stats.injections, 1); assert.equal(stats.disposed, 1);
});

test('three attempts is the hard limit and the first original error is preserved', async () => {
  const errors = [navigationError(), navigationError(), navigationError()];
  let injections = 0;
  const { recover, stats } = fixture({ inject: async () => { throw errors[injections++]; } });
  await assert.rejects(recover(), error => error === errors[0]);
  assert.equal(injections, 3); assert.equal(stats.waits, 3); assert.equal(stats.disposed, 3);
});

test('failed readiness attempts count toward the same three-attempt limit', async () => {
  const { recover, page, stats } = fixture();
  const original = navigationError(); let waits = 0;
  page.waitForFunction = async () => { waits++; throw original; };
  await assert.rejects(recover(), error => error === original);
  assert.equal(waits, 3); assert.equal(stats.injections, 0);
});

for (const original of [
  new Error('Protocol error (Runtime.callFunctionOn): Cannot find context with specified id'),
  new Error('net::ERR_INTERNET_DISCONNECTED'),
  new Error('Authentication failed'),
  Object.assign(new Error('Protocol error (Runtime.callFunctionOn): Target closed'), { name: 'TargetCloseError' }),
  'auth timeout'
]) {
  test(`propagates non-transient failure without retry: ${typeof original === 'string' ? original : original.message}`, async () => {
    let calls = 0;
    const { recover } = fixture({ inject: async () => { calls++; throw original; } });
    await assert.rejects(recover(), error => error === original);
    assert.equal(calls, 1);
  });
}

test('Puppeteer wait timeout propagates unchanged and does not inject', async () => {
  const original = Object.assign(new Error('Waiting failed: 20ms exceeded'), { name: 'TimeoutError' });
  const { recover, page, stats } = fixture();
  page.waitForFunction = async () => { throw original; };
  await assert.rejects(recover(), error => error === original);
  assert.equal(stats.injections, 0);
});

test('total deadline aborts a pending wait and reports timeout', async () => {
  const { recover, page, stats } = fixture({ timeoutMs: 25 });
  let waitSignal;
  page.waitForFunction = (_fn, { signal }) => {
    waitSignal = signal;
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  };
  await assert.rejects(recover(), { name: 'TimeoutError' });
  assert.equal(waitSignal.aborted, true); assert.equal(stats.injections, 0);
});

test('attempts share a shrinking budget and deadline retains the navigation cause', async () => {
  let clock = 0;
  const original = navigationError();
  const { recover, stats } = fixture({ timeoutMs: 30_000, now: () => clock, inject: async () => {
    clock += 16_000; throw original;
  } });
  await assert.rejects(recover(), error => error.name === 'TimeoutError' && error.cause === original);
  assert.deepEqual(stats.budgets, [30_000, 14_000]);
});

test('cancel during wait resolves quietly, aborts Puppeteer and never injects', async () => {
  const controller = new AbortController();
  const { recover, page, stats } = fixture({ signal: controller.signal });
  let waitSignal;
  page.waitForFunction = (_fn, { signal }) => {
    waitSignal = signal;
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  };
  const pending = recover(); controller.abort();
  assert.equal(await pending, undefined); assert.equal(waitSignal.aborted, true);
  await recover(); assert.equal(stats.injections, 0);
});

test('a handle arriving after cancellation is still disposed', async () => {
  const controller = new AbortController(), waiting = deferred();
  const { recover, page, stats } = fixture({ signal: controller.signal });
  page.waitForFunction = () => waiting.promise;
  const pending = recover(); controller.abort(); await pending;
  let disposed = 0;
  waiting.resolve({ async dispose() { disposed++; } });
  await tick(); assert.equal(disposed, 1); assert.equal(stats.injections, 0);
});

test('concurrent callers share the exact same promise through wait and injection', async () => {
  const waiting = deferred(), injecting = deferred(), entered = deferred();
  let calls = 0, disposed = 0;
  const { recover, page } = fixture({ inject: () => { calls++; entered.resolve(); return injecting.promise; } });
  page.waitForFunction = () => waiting.promise;
  const first = recover(); assert.equal(recover(), first);
  waiting.resolve({ async dispose() { disposed++; } });
  await entered.promise; assert.equal(recover(), first);
  injecting.resolve('done'); assert.equal(await first, 'done');
  assert.equal(calls, 1); assert.equal(disposed, 1);
});

test('new calls work after either success or failure', async () => {
  let calls = 0;
  const original = new Error('Protocol error: non-transient');
  const { recover } = fixture({ inject: async () => {
    if (++calls === 2) throw original;
    return calls;
  } });
  const first = recover(); assert.equal(await first, 1);
  const second = recover(); assert.notEqual(first, second);
  await assert.rejects(second, error => error === original);
  assert.equal(await recover(), 3);
});

test('timeout during injection does not release the gate while library JS is still running', async () => {
  const injecting = deferred(), entered = deferred(); let calls = 0;
  const { recover } = fixture({ timeoutMs: 25, inject: () => {
    calls++; entered.resolve(); return calls === 1 ? injecting.promise : 'next';
  } });
  const pending = recover();
  const rejected = assert.rejects(pending, { name: 'TimeoutError' });
  await entered.promise; await rejected;
  assert.equal(recover(), pending); assert.equal(calls, 1);
  injecting.resolve(); await tick();
  assert.equal(await recover(), 'next'); assert.equal(calls, 2);
});

test('intentional provider close cancels attached recovery and leaves a stopped provider', async () => {
  const provider = new WhatsAppProvider();
  let injected = 0, destroyed = 0, waitSignal;
  const client = {
    pupPage: { waitForFunction(_fn, { signal }) {
      waitSignal = signal;
      return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    } },
    inject() { injected++; },
    async destroy() { destroyed++; }
  };
  provider.attachClient(client);
  const pending = client.inject(); await provider.close(); await pending;
  await client.inject();
  assert.equal(waitSignal.aborted, true); assert.equal(injected, 0);
  assert.equal(destroyed, 1); assert.equal(provider.state, 'stopped');
});

test('provider fallback terminates only its live ChildProcess, never an exited PID', async () => {
  for (const exited of [false, true]) {
    let kills = 0;
    const proc = { pid: 12345, exitCode: null, signalCode: null, killed: false,
      kill(signal) { assert.equal(signal, 'SIGKILL'); kills++; } };
    const provider = new WhatsAppProvider();
    provider.client = { pupBrowser: { process: () => proc }, async destroy() { if (exited) proc.exitCode = 0; } };
    await provider.close(); assert.equal(kills, exited ? 0 : 1);
  }
});

test('only the execution-context-destroyed message is transient; limits cannot be enlarged', () => {
  assert.equal(isNavigationContextDestroyed(navigationError()), true);
  for (const error of [null, 'Execution context was destroyed', new Error('Protocol error'), new Error('Target closed')]) {
    assert.equal(isNavigationContextDestroyed(error), false);
  }
  for (const options of [{ maxAttempts: 4 }, { maxAttempts: 0 }, { timeoutMs: 30_001 }, { timeoutMs: 0 }]) {
    assert.throws(() => fixture(options), RangeError);
  }
});
