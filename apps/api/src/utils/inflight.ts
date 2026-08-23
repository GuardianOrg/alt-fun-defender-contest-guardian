/** Waiter timeout. 8s-budget keys wait this long too — one timeout has to clear the 20s heavy abort. */
export const INFLIGHT_TIMEOUT_MS = 25_000;

export const INFLIGHT_TIMEOUT_MESSAGE = "in-flight wait timed out";

/**
 * Minimal execution-context shape so request handlers can keep a shared
 * owner promise alive, while cron/tests omit it.
 */
export interface WaitUntilHost {
  waitUntil(promise: Promise<unknown>): void;
}

/** Hono's `executionCtx` getter throws when tests omit an ExecutionContext. */
export function tryExecutionCtx(c: object): WaitUntilHost | undefined {
  try {
    return (c as { executionCtx: WaitUntilHost }).executionCtx;
  } catch {
    return undefined;
  }
}

/**
 * Pin `promise` so a disconnect cannot tear down I/O others joined.
 * Swallows rejection so `waitUntil` is not an unhandled reject.
 */
export function keepInflightAlive(
  ctx: WaitUntilHost | undefined,
  promise: Promise<unknown>,
): void {
  const handled = promise.then(
    () => undefined,
    () => undefined,
  );
  ctx?.waitUntil(handled);
}

export function isInflightTimeout(err: unknown): boolean {
  return err instanceof Error && err.message === INFLIGHT_TIMEOUT_MESSAGE;
}

/** Map a spent inflight retry onto the read's error sentinel so routes 503. */
export async function fallbackOnInflightTimeout<T>(
  promise: Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await promise;
  } catch (err) {
    if (isInflightTimeout(err)) return fallback;
    throw err;
  }
}

export function logInflightEviction(key: string, elapsedMs: number): void {
  console.log(
    JSON.stringify({
      level: "warn",
      event: "inflight_evicted",
      key,
      elapsedMs,
      timestamp: new Date().toISOString(),
    }),
  );
}

/**
 * Await `promise`, but if it has not settled by `timeoutMs` run `evict`
 * and reject. `evict` must identity-check so a newer owner is not dropped.
 */
export function awaitWithTimeout<T>(
  promise: Promise<T>,
  evict: () => void,
  timeoutMs: number = INFLIGHT_TIMEOUT_MS,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      evict();
      reject(new Error(INFLIGHT_TIMEOUT_MESSAGE));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
