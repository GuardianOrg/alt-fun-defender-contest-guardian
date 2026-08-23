import { afterEach, describe, expect, it, vi } from "vitest";

import {
  _currentOutboundTimeoutMs,
  DEFAULT_OUTBOUND_TIMEOUT_MS,
  fetchWithOutboundTimeout,
  HEAVY_READ_TIMEOUT_MS,
  runWithOutboundTimeout,
} from "../utils/outbound-timeout.js";

function hangingFetch(): typeof fetch {
  return (async (_input: RequestInfo | URL, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new DOMException("aborted", "AbortError"));
      });
    });
  }) as typeof fetch;
}

describe("fetchWithOutboundTimeout", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the upstream response when it settles in time", async () => {
    const originalFetch = globalThis.fetch;
    (globalThis as { fetch: typeof fetch }).fetch = (async () =>
      new Response("ok", { status: 200 })) as typeof fetch;
    try {
      const res = await fetchWithOutboundTimeout("https://example.test/sql");
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("ok");
    } finally {
      (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
    }
  });

  it("aborts a hung fetch when the outbound budget elapses", async () => {
    const originalFetch = globalThis.fetch;
    let observedSignal: AbortSignal | undefined;
    (globalThis as { fetch: typeof fetch }).fetch = (async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      observedSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    }) as typeof fetch;

    try {
      await expect(
        runWithOutboundTimeout(50, () =>
          fetchWithOutboundTimeout("https://example.test/sql"),
        ),
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(observedSignal?.aborted).toBe(true);
    } finally {
      (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
    }
  });

  it("uses the per-call budget from runWithOutboundTimeout", async () => {
    const originalFetch = globalThis.fetch;
    (globalThis as { fetch: typeof fetch }).fetch = hangingFetch();

    vi.useFakeTimers();
    try {
      const pending = runWithOutboundTimeout(50, () =>
        fetchWithOutboundTimeout("https://example.test/sql"),
      );
      const assertion = expect(pending).rejects.toMatchObject({
        name: "AbortError",
      });
      await vi.advanceTimersByTimeAsync(50);
      await assertion;
    } finally {
      (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
    }
  });

  it("still uses the wrapped budget after the callback awaits", async () => {
    const originalFetch = globalThis.fetch;
    (globalThis as { fetch: typeof fetch }).fetch = hangingFetch();

    vi.useFakeTimers();
    try {
      const pending = runWithOutboundTimeout(50, async () => {
        await Promise.resolve();
        return fetchWithOutboundTimeout("https://example.test/sql");
      });
      const assertion = expect(pending).rejects.toMatchObject({
        name: "AbortError",
      });
      await vi.advanceTimersByTimeAsync(50);
      await assertion;
    } finally {
      (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
    }
  });

  it("keeps concurrent wraps from sharing one budget", async () => {
    const seen = await Promise.all([
      runWithOutboundTimeout(50, async () => {
        await Promise.resolve();
        return _currentOutboundTimeoutMs();
      }),
      runWithOutboundTimeout(HEAVY_READ_TIMEOUT_MS, async () => {
        await Promise.resolve();
        return _currentOutboundTimeoutMs();
      }),
    ]);
    expect(new Set(seen)).toEqual(new Set([50, HEAVY_READ_TIMEOUT_MS]));
  });

  it("still aborts if headers arrive and the body stalls", async () => {
    const originalFetch = globalThis.fetch;
    (globalThis as { fetch: typeof fetch }).fetch = (async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            init?.signal?.addEventListener("abort", () => {
              controller.error(new DOMException("aborted", "AbortError"));
            });
          },
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    try {
      const pending = runWithOutboundTimeout(50, async () => {
        const res = await fetchWithOutboundTimeout("https://example.test/sql");
        return res.text();
      });
      await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    } finally {
      (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
    }
  });

  it("keeps the heavy-read budget above the default", () => {
    expect(DEFAULT_OUTBOUND_TIMEOUT_MS).toBe(8_000);
    expect(HEAVY_READ_TIMEOUT_MS).toBeGreaterThan(DEFAULT_OUTBOUND_TIMEOUT_MS);
    expect(HEAVY_READ_TIMEOUT_MS).toBeLessThan(100_000);
  });

  it("forwards an already-aborted caller signal without waiting out the budget", async () => {
    const originalFetch = globalThis.fetch;
    let observedAborted = false;
    (globalThis as { fetch: typeof fetch }).fetch = (async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      observedAborted = init?.signal?.aborted === true;
      throw new DOMException("aborted", "AbortError");
    }) as typeof fetch;

    const caller = new AbortController();
    caller.abort();
    try {
      await expect(
        fetchWithOutboundTimeout("https://example.test/sql", {
          signal: caller.signal,
        }),
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(observedAborted).toBe(true);
    } finally {
      (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
    }
  });
});

describe("createDb neon fetch timeout", () => {
  it("installs the timed fetch on neonConfig so every neon HTTP call is armed", async () => {
    const { neonConfig } = await import("@neondatabase/serverless");
    const { fetchWithOutboundTimeout: timedFetch } = await import(
      "../utils/outbound-timeout.js"
    );
    await import("../db/client.js");
    expect(neonConfig.fetchFunction).toBe(timedFetch);
  });
});
