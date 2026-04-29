import { describe, it, expect, vi, beforeEach } from "vitest";

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
    expect(mockFetch).toHaveBeenCalledWith("http://test-ponder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "query { token { name } }", variables: undefined }),
    });
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
