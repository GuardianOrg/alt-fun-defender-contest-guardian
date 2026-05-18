import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchRouterTradesGlobal, fetchTokenMeta } from "../api";

/**
 * `fetchRouterTradesGlobal` powers the home-page recent-trades feed and
 * gained an `offset` parameter to drive infinite scroll (issue #807).
 * The route's offset support is covered by `apps/api/src/__tests__/
 * trades.test.ts`; these cases pin the client-side query-string assembly
 * so the two ends stay wired up.
 */
describe("fetchRouterTradesGlobal", () => {
  let fetchMock: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ status: "success", data: [], error: null }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  it("threads both limit and offset into the query string", async () => {
    await fetchRouterTradesGlobal(20, 40);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("/api/v1/trades?");
    expect(url).toContain("limit=20");
    expect(url).toContain("offset=40");
  });

  it("defaults offset to 0 when only limit is provided", async () => {
    await fetchRouterTradesGlobal(50);

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("limit=50");
    expect(url).toContain("offset=0");
  });
});

/**
 * `fetchTokenMeta` replaces the browser's previous direct POST to the
 * Ponder GraphQL endpoint (issue #942 — `services/ponder.ts` removed in
 * this PR). The cache layer in `services/tokenNames.ts` relies on the
 * never-throws / `null`-on-failure contract, so pin those branches here.
 */
describe("fetchTokenMeta", () => {
  const ADDR = "0x4DFB6bebbdF9d5ea76123729E0b3a823f9c3ecC0";
  let fetchMock: ReturnType<typeof vi.spyOn>;

  afterEach(() => {
    fetchMock?.mockRestore();
  });

  it("returns the row when the API responds success", async () => {
    fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "success",
          data: { address: ADDR.toLowerCase(), name: "Test Token", symbol: "TST" },
          error: null,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const meta = await fetchTokenMeta(ADDR);

    expect(meta).toEqual({ address: ADDR.toLowerCase(), name: "Test Token", symbol: "TST" });
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain(`/api/v1/tokens/${ADDR}/meta`);
  });

  it("returns null when the API responds 200 with data: null (token not yet indexed)", async () => {
    // Mirrors the route's behaviour for an address that exists on-chain
    // but hasn't been indexed yet — the route returns
    // `{status:"success", data:null}` so the caller can treat
    // "indexed but not found" the same as "no data yet" without
    // branching on status codes. The cache layer turns this into a retry.
    fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ status: "success", data: null, error: null }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    expect(await fetchTokenMeta(ADDR)).toBeNull();
  });

  it("returns null when the API responds error (e.g. 503 indexer unavailable)", async () => {
    fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ status: "error", data: null, error: "Indexer unavailable" }),
        { status: 503, headers: { "Content-Type": "application/json" } },
      ),
    );

    expect(await fetchTokenMeta(ADDR)).toBeNull();
  });

  it("returns null when fetch itself throws (network failure)", async () => {
    // Cache layer must not throw — a transient network blip should
    // leave the truncated-address fallback in place and let the next
    // prefetch retry. The `try/catch` inside `fetchTokenMeta` is what
    // makes the surrounding `tokenNames` code able to drop the explicit
    // `.catch()` it used to need.
    fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("offline"));

    expect(await fetchTokenMeta(ADDR)).toBeNull();
  });
});
