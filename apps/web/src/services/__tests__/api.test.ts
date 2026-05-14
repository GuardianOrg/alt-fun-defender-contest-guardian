import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchRouterTradesGlobal } from "../api";

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
