// Only this specific failure means that an injection may be retried safely.
export function isNavigationContextDestroyed(error) {
  return typeof error?.message === 'string' &&
    /\bExecution context was destroyed\b/.test(error.message);
}

/**
 * Serialize injection, including the page-readiness wait, within one deadline.
 * Provider cancellation resolves quietly so whatsapp-web.js's async navigation
 * listener cannot turn an intentional shutdown into an unhandled rejection.
 * Every other failure rejects; library error objects are never logged or copied.
 */
export function createNavigationRecovery({ getPage, inject, signal,
  maxAttempts = 3, timeoutMs = 30_000, now = () => performance.now() }) {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3 ||
      !Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30_000) {
    throw new RangeError('Navigation recovery permits 1–3 attempts and at most 30000 ms.');
  }
  let inFlight = null;
  return function recover() {
    if (inFlight) return inFlight;
    if (signal?.aborted) return Promise.resolve();

    const operation = new AbortController();
    const deadline = now() + timeoutMs;
    let firstNavigationError, resolve, reject;
    inFlight = new Promise((yes, no) => { resolve = yes; reject = no; });
    const result = inFlight;
    const expire = () => {
      if (operation.signal.aborted) return;
      const error = new Error('Browser navigation recovery timed out.', { cause: firstNavigationError });
      error.name = 'TimeoutError';
      operation.abort(error);
      reject(error);
    };
    const cancel = () => {
      if (operation.signal.aborted) return;
      operation.abort(signal.reason);
      resolve();
    };
    signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(expire, timeoutMs);
    const checkActive = () => {
      if (now() >= deadline) expire();
      operation.signal.throwIfAborted();
    };
    const run = async () => {
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        checkActive();
        try {
          const handle = await getPage().waitForFunction(
            () => document.readyState === 'complete' && window.Debug?.VERSION !== undefined,
            { polling: 100, timeout: Math.max(1, Math.ceil(deadline - now())), signal: operation.signal }
          );
          // Dispose even if a wait resolves after cancellation or expiry. Do not
          // retain a JSHandle while the library installs its own page bindings.
          await handle.dispose();
          checkActive();
          const value = await inject();
          checkActive();
          return value;
        } catch (error) {
          operation.signal.throwIfAborted();
          if (!isNavigationContextDestroyed(error)) throw error;
          firstNavigationError ??= error;
          if (attempt === maxAttempts) throw firstNavigationError;
        }
      }
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      inFlight = null;
    };
    // Keep the gate until the underlying operation actually settles. A deadline
    // cannot cancel arbitrary library JS: releasing it early would allow overlap.
    void run().then(value => {
      cleanup(); resolve(value);
    }, error => {
      cleanup();
      if (signal?.aborted && operation.signal.reason === signal.reason) resolve();
      else reject(error);
    });
    return result;
  };
}
