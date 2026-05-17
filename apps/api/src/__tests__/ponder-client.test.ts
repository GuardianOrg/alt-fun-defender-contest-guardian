import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  checkPonderHealth,
  createPonderQuery,
  createPonderPaginatedQuery,
} from "../lib/ponder-client.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("createPonderQuery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns data on successful query", async () => {
    const queryPonder = createPonderQuery("http://test-ponder");
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { token: { name: "Test" } } }),
    });

    const result = await queryPonder<{ token: { name: string } }>(
      "query { token { name } }",
    );

    expect(result).toEqual({ token: { name: "Test" } });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://test-ponder",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: "query { token { name } }",
          variables: undefined,
        }),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  // Regression: a stalled Ponder upstream (Neon connection drop, indexer
  // single-isolate contention) used to consume the full Cloudflare subrequest
  // budget. Every read-side caller — including the bot's /positions endpoint —
  // sat blocked on this fetch. Now bounded by QUERY_TIMEOUT_MS so the failure
  // surfaces as a fast `null`. Suppress the console.log so the test output
  // isn't polluted by the structured network_error log line.
  it("aborts a stalled fetch and returns null", async () => {
    vi.useFakeTimers();
    const consoleLogSpy = vi
      .spyOn(console, "log")
      .mockImplementation(() => {});
    try {
      const queryPonder = createPonderQuery("http://test-ponder");
      mockFetch.mockImplementation(
        (_url: unknown, init?: RequestInit) =>
          new Promise<Response>((_, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("aborted", "AbortError"));
            });
          }),
      );
      const pending = queryPonder("query { token { name } }");
      await vi.advanceTimersByTimeAsync(8000);
      expect(await pending).toBeNull();
    } finally {
      consoleLogSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("returns null when response is not ok", async () => {
    const queryPonder = createPonderQuery("http://test-ponder");
    mockFetch.mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({}),
    });

    const result = await queryPonder("query { token { name } }");
    expect(result).toBeNull();
  });

  it("returns null when response contains errors", async () => {
    const queryPonder = createPonderQuery("http://test-ponder");
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ errors: [{ message: "not found" }] }),
    });

    const result = await queryPonder("query { token { name } }");
    expect(result).toBeNull();
  });

  it("returns null when fetch throws", async () => {
    const queryPonder = createPonderQuery("http://test-ponder");
    mockFetch.mockRejectedValue(new Error("network error"));

    const result = await queryPonder("query { token { name } }");
    expect(result).toBeNull();
  });

  it("returns null when response has no data field", async () => {
    const queryPonder = createPonderQuery("http://test-ponder");
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });

    const result = await queryPonder("query { token { name } }");
    expect(result).toBeNull();
  });

  it("uses fallback URL when no URL provided", async () => {
    const queryPonder = createPonderQuery();
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { test: true } }),
    });

    await queryPonder("query { test }");

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:42069",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("passes variables to the query", async () => {
    const queryPonder = createPonderQuery("http://test-ponder");
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { token: null } }),
    });

    await queryPonder("query ($id: String!) { token(id: $id) { name } }", {
      id: "0x123",
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "http://test-ponder",
      expect.objectContaining({
        body: JSON.stringify({
          query: "query ($id: String!) { token(id: $id) { name } }",
          variables: { id: "0x123" },
        }),
      }),
    );
  });
});

describe("createPonderPaginatedQuery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("collects all items across pages", async () => {
    const queryAll = createPonderPaginatedQuery("http://test-ponder");
    const page1Items = Array.from({ length: 1000 }, (_, i) => ({ id: i }));
    const page2Items = [{ id: 1000 }, { id: 1001 }];

    let callCount = 0;
    mockFetch.mockImplementation(() => {
      callCount++;
      const items = callCount === 1 ? page1Items : page2Items;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: { collection: { items } } }),
      });
    });

    const result = await queryAll(
      "query ($limit: Int!, $offset: Int!) { collection(limit: $limit, offset: $offset) { items { id } } }",
      "collection",
    );

    expect(result.items).toHaveLength(1002);
    expect(result.truncated).toBe(false);
    expect(callCount).toBe(2);
  });

  it("returns empty items when first page returns null", async () => {
    const queryAll = createPonderPaginatedQuery("http://test-ponder");
    mockFetch.mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({}),
    });

    const result = await queryAll(
      "query ($limit: Int!, $offset: Int!) { collection(limit: $limit, offset: $offset) { items { id } } }",
      "collection",
    );

    expect(result.items).toEqual([]);
    expect(result.truncated).toBe(false);
  });

});

describe("checkPonderHealth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("queries the tokens collection (a real table) — not just { __typename }", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ data: { tokens: { items: [{ address: "0x1" }] } } }),
    });

    const healthy = await checkPonderHealth("http://test-ponder");
    expect(healthy).toBe(true);

    // The probe MUST hit the database, otherwise a Ponder with a closed
    // PGlite (stale dev process) passes the check while real queries hang.
    // See `apps/indexer/scripts/dev.mjs` for the indexer-side guard that
    // backs this contract up.
    const [, init] = mockFetch.mock.calls[0];
    expect(init.body).toContain("tokens");
    expect(init.body).not.toContain("__typename");
  });

  it("returns true when the tokens collection is empty (fresh indexer)", async () => {
    // A freshly-deployed contract with no tokens yet still answers `tokens`
    // with an empty `items` array. Ponder is healthy and able to serve
    // queries — we must not flap to unhealthy in this case or `/health`
    // would lie on every cold start.
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { tokens: { items: [] } } }),
    });

    expect(await checkPonderHealth("http://test-ponder")).toBe(true);
  });

  it("returns false when GraphQL responds with errors", async () => {
    // PGlite-closed errors surface as GraphQL `errors`, not HTTP 5xx.
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ errors: [{ message: "PGlite is closed" }] }),
    });

    expect(await checkPonderHealth("http://test-ponder")).toBe(false);
  });

  it("returns false when fetch rejects", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));
    expect(await checkPonderHealth("http://test-ponder")).toBe(false);
  });

  it("returns false when response is missing the tokens field", async () => {
    // Defensive: catches the case where `PONDER_URL` points at an unrelated
    // GraphQL endpoint that happens to accept POSTs but doesn't expose our
    // schema.
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { somethingElse: 1 } }),
    });

    expect(await checkPonderHealth("http://test-ponder")).toBe(false);
  });
});

describe("logPonderFailure — error.cause unwrapping (issue #974)", () => {
  // The same diagnostic gap that motivated `logIndexerReadFailure` applies
  // here: a fetch exception with the underlying transport failure
  // (timeout, AbortSignal, IPv6 fallback) buried in `error.cause` is
  // currently logged as just the wrapper message — useless for triage.
  // Mirror the shape so Cloudflare log search can pivot on the same
  // fields across both code paths.
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    // `vi.clearAllMocks()` resets call history but keeps `console.log`
    // mocked. Restore so later describes don't inherit a swallowed
    // logger. CodeRabbit feedback on PR #983.
    vi.restoreAllMocks();
  });

  function captureLastErrorPayload(): Record<string, unknown> {
    expect(consoleLogSpy).toHaveBeenCalled();
    const calls = consoleLogSpy.mock.calls;
    const [raw] = calls[calls.length - 1] as [string];
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return parsed.error as Record<string, unknown>;
  }

  it("surfaces error.cause / code / sourceError on a network_error log line", async () => {
    const queryPonder = createPonderQuery("http://test-ponder");
    const cause = new Error("ETIMEDOUT");
    cause.name = "FetchError";
    const thrown = Object.assign(new Error("fetch failed"), {
      cause,
      code: "ETIMEDOUT",
      sourceError: { phase: "connect" },
    });
    mockFetch.mockRejectedValue(thrown);

    const result = await queryPonder("query { token { name } }");
    expect(result).toBeNull();

    const errorPayload = captureLastErrorPayload();
    expect(errorPayload.name).toBe("Error");
    expect(errorPayload.message).toBe("fetch failed");
    expect(errorPayload.code).toBe("ETIMEDOUT");
    const causeShape = errorPayload.cause as Record<string, unknown>;
    expect(causeShape.name).toBe("FetchError");
    expect(causeShape.message).toBe("ETIMEDOUT");
    expect(errorPayload.sourceError).toEqual({ phase: "connect" });
  });

  it("preserves legacy non-Error fallback (String(error)) for thrown primitives", async () => {
    const queryPonder = createPonderQuery("http://test-ponder");
    mockFetch.mockRejectedValue("kaboom");

    await queryPonder("query { token { name } }");

    const log = JSON.parse(consoleLogSpy.mock.calls[0]![0] as string) as {
      error: unknown;
    };
    expect(log.error).toBe("kaboom");
  });
});

describe("createPonderPaginatedQuery — early termination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stops when a page returns fewer items than PAGE_SIZE", async () => {
    const queryAll = createPonderPaginatedQuery("http://test-ponder");
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { items: { items: [{ id: 1 }] } } }),
    });

    const result = await queryAll(
      "query ($limit: Int!, $offset: Int!) { items(limit: $limit, offset: $offset) { items { id } } }",
      "items",
    );

    expect(result.items).toHaveLength(1);
    expect(result.truncated).toBe(false);
    // Should only make one fetch since page had < 1000 items
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
