import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Default Neon/BounceTech abort. Slow chart/list reads wrap with
 * {@link HEAVY_READ_TIMEOUT_MS} instead; a single global 8s budget is too tight
 * for those. This abort does not rescue a cancelled owner — that timer dies
 * with the request — it only bounds a live invocation against a slow upstream.
 */
export const DEFAULT_OUTBOUND_TIMEOUT_MS = 8_000;

/**
 * Chart and list reads. Measured chart e2e ~2.3s and a `router_trade` query
 * ~5.1s; 20s leaves headroom and stays far under Cloudflare's 100s ceiling.
 */
export const HEAVY_READ_TIMEOUT_MS = 20_000;

const timeoutStore = new AsyncLocalStorage<number>();

/**
 * Bind `timeoutMs` across awaits of `fn` so nested Neon fetches keep this
 * budget. ALS is per async context, so concurrent requests cannot steal it.
 * The budget is the owner's: a waiter joining an 8s fetch does not get 20s.
 */
export function runWithOutboundTimeout<T>(timeoutMs: number, fn: () => T): T {
  return timeoutStore.run(timeoutMs, fn);
}

/** Test-only: the budget bound to this async context, if any. */
export function _currentOutboundTimeoutMs(): number | undefined {
  return timeoutStore.getStore();
}

/**
 * `fetch` that aborts when the remote hasn't answered, including a stalled
 * body. `AbortSignal.timeout` stays armed after headers; aborting the Worker
 * fetch does not stop the query server-side.
 */
export async function fetchWithOutboundTimeout(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const timeoutMs =
    timeoutStore.getStore() ?? DEFAULT_OUTBOUND_TIMEOUT_MS;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const callerSignal = init?.signal;
  const signal = callerSignal
    ? AbortSignal.any([callerSignal, timeoutSignal])
    : timeoutSignal;
  return fetch(input, { ...init, signal });
}
