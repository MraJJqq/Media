import { createLifecycleScope } from "./lifecycle.js?v=v4-foundation-1";

const API_BASE = "https://api.bitget.com";
const REQUEST_TIMEOUT_MS = 12_000;
const MAX_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 350;
const wait = (ms, signal) => new Promise((resolve, reject) => {
  if (signal.aborted) {
    reject(abortError(signal.reason));
    return;
  }
  const timer = setTimeout(() => {
    signal.removeEventListener("abort", onAbort);
    resolve();
  }, ms);
  const onAbort = () => {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
    reject(abortError(signal.reason));
  };
  signal.addEventListener("abort", onAbort, { once: true });
});

function abortError(reason) {
  const error = new Error(String(reason || "Request aborted"));
  error.name = "AbortError";
  error.abortReason = reason || "aborted";
  return error;
}

function annotate(error, path, stage) {
  const result = error instanceof Error ? error : new Error(String(error));
  result.endpoint = path.split("?")[0];
  result.transportStage = stage;
  return result;
}

export function createBitgetClient({
  fetchImpl = globalThis.fetch,
  baseUrl = API_BASE,
  timeoutMs = REQUEST_TIMEOUT_MS,
  maxAttempts = MAX_ATTEMPTS,
  backoffBaseMs = BACKOFF_BASE_MS,
  maxConcurrent = 2,
  isHidden = () => typeof document !== "undefined" && document.hidden
} = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl must be a function");
  const lifecycle = createLifecycleScope();
  const active = new Set();
  const waiters = [];
  const concurrencyLimit = Math.max(1, Math.floor(maxConcurrent));
  let running = 0;
  let destroyed = false;

  function createSlotRelease() {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      running--;
      pumpWaiters();
    };
  }

  function pumpWaiters() {
    while (running < concurrencyLimit && waiters.length) {
      const waiter = waiters.shift();
      waiter.controller.signal.removeEventListener("abort", waiter.onAbort);
      if (waiter.controller.signal.aborted) {
        waiter.reject(abortError(waiter.controller.signal.reason));
        continue;
      }
      running++;
      waiter.resolve(createSlotRelease());
    }
  }

  function acquireSlot(controller) {
    if (controller.signal.aborted) return Promise.reject(abortError(controller.signal.reason));
    if (running < concurrencyLimit && waiters.length === 0) {
      running++;
      return Promise.resolve(createSlotRelease());
    }
    return new Promise((resolve, reject) => {
      const waiter = { controller, resolve, reject, onAbort: null };
      waiter.onAbort = () => {
        const index = waiters.indexOf(waiter);
        if (index !== -1) waiters.splice(index, 1);
        reject(abortError(controller.signal.reason));
      };
      controller.signal.addEventListener("abort", waiter.onAbort, { once: true });
      waiters.push(waiter);
    });
  }

  async function request(path, { signal } = {}) {
    if (destroyed) throw abortError("client-destroyed");
    if (isHidden()) {
      const error = abortError("page-hidden");
      error.pageHidden = true;
      throw error;
    }

    let lastError;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (destroyed || lifecycle.signal.aborted) throw abortError("client-destroyed");
      if (signal?.aborted) throw abortError(signal.reason);
      if (isHidden()) {
        const error = abortError("page-hidden");
        error.pageHidden = true;
        throw error;
      }

      const controller = new AbortController();
      active.add(controller);
      const abortFromLifecycle = () => controller.abort("client-destroyed");
      const abortFromCaller = () => controller.abort(signal.reason || "caller-aborted");
      lifecycle.signal.addEventListener("abort", abortFromLifecycle, { once: true });
      signal?.addEventListener("abort", abortFromCaller, { once: true });
      let timeout = 0;
      let releaseSlot = () => {};
      let stage = "fetch";

      try {
        releaseSlot = await acquireSlot(controller);
        if (controller.signal.aborted) throw abortError(controller.signal.reason);
        timeout = setTimeout(() => controller.abort("timeout"), timeoutMs);
        const response = await fetchImpl(baseUrl + path, {
          cache: "no-store",
          signal: controller.signal
        });
        stage = "http";
        if (!response.ok) {
          const error = new Error("Bitget HTTP " + response.status);
          error.retryable = response.status === 429 || response.status >= 500;
          throw error;
        }

        stage = "json";
        const payload = await response.json();
        if (payload?.code !== "00000" || !Array.isArray(payload.data)) {
          const error = new Error(payload?.msg || "Bitget response invalid");
          error.retryable = String(payload?.code) === "429" ||
            /too many|rate limit/i.test(String(payload?.msg || ""));
          throw error;
        }
        return payload.data;
      } catch (caught) {
        const error = annotate(caught, path, stage);
        const reason = controller.signal.reason;
        if (reason === "page-hidden") error.pageHidden = true;
        if (reason === "timeout") error.retryable = true;
        if (error.name === "TypeError") error.retryable = true;
        lastError = error;

        const cancelled = reason === "client-destroyed" ||
          reason === "caller-aborted" ||
          signal?.aborted;
        const retryable = !cancelled && !error.pageHidden &&
          (error.retryable === true || (error.name === "AbortError" && reason === "timeout"));
        if (!retryable || attempt === maxAttempts - 1 || isHidden() || destroyed) throw error;
      } finally {
        if (timeout) clearTimeout(timeout);
        releaseSlot();
        lifecycle.signal.removeEventListener("abort", abortFromLifecycle);
        signal?.removeEventListener("abort", abortFromCaller);
        active.delete(controller);
      }

      await wait(backoffBaseMs * (2 ** attempt), lifecycle.signal);
    }
    throw lastError || new Error("Bitget request failed");
  }

  function abortAll(reason = "page-hidden") {
    for (const controller of active) controller.abort(reason);
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    abortAll("client-destroyed");
    lifecycle.destroy();
  }

  return Object.freeze({ request, abortAll, destroy });
}

export const futuresTickerPath = "/api/v2/mix/market/tickers?productType=USDT-FUTURES";

