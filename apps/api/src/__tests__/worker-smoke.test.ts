/// <reference types="@cloudflare/vitest-pool-workers/types" />

/**
 * Worker integration tests — run inside the actual Workers runtime (Workerd)
 * via @cloudflare/vitest-pool-workers, hitting the real Neon database.
 *
 * These catch:
 * - Runtime-incompatible modules (e.g. TCP-based postgres driver hanging)
 * - Missing CORS middleware
 * - DB schema mismatches between Drizzle and the actual database
 * - Broken read endpoints
 *
 * Requires DATABASE_URL in .dev.vars (local) or CI environment.
 */

import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";

const TEST_TOKEN = "0x26F8ED8C7548e066Bea4A86412aD7f099E30caBb";
const TEST_CREATOR = "0x681E6a109e586bAE0FD5e4b5aCad8e20E0e600BA";
const NONEXISTENT_ADDRESS = "0x0000000000000000000000000000000000000001";

interface ApiResponse<T = unknown> {
  status: string;
  data: T;
  error: string | null;
  dataSource?: string;
}

async function fetchJson<T = unknown>(path: string): Promise<{ res: Response; body: ApiResponse<T> }> {
  const res = await SELF.fetch(`http://localhost${path}`);
  const body = (await res.json()) as ApiResponse<T>;
  return { res, body };
}

// ─── Worker runtime basics ───────────────────────────────────────────

describe("Worker runtime", () => {
  it("root endpoint responds", async () => {
    const { res, body } = await fetchJson("/");
    expect(res.status).toBe(200);
    expect(body.status).toBe("success");
  });

  it("health endpoint responds", async () => {
    const { res, body } = await fetchJson<{ services: { api: boolean } }>("/health");
    expect(res.status).toBe(200);
    expect(body.data.services.api).toBe(true);
  });

  it("unknown routes return 404", async () => {
    const { res } = await fetchJson("/does-not-exist");
    expect(res.status).toBe(404);
  });
});

// ─── CORS ────────────────────────────────────────────────────────────

describe("CORS", () => {
  it("success responses include Access-Control-Allow-Origin", async () => {
    const res = await SELF.fetch("http://localhost/");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("error responses include Access-Control-Allow-Origin", async () => {
    const res = await SELF.fetch("http://localhost/does-not-exist");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("preflight OPTIONS returns correct headers", async () => {
    const res = await SELF.fetch("http://localhost/api/v1/tokens", {
      method: "OPTIONS",
      headers: {
        Origin: "https://example.com",
        "Access-Control-Request-Method": "GET",
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toContain("GET");
  });
});

// ─── Token endpoints (DB) ────────────────────────────────────────────

describe("GET /api/v1/tokens", () => {
  it("returns a list of tokens", async () => {
    const { res, body } = await fetchJson<unknown[]>("/api/v1/tokens?limit=10&offset=0");
    expect(res.status).toBe(200);
    expect(body.status).toBe("success");
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
  });

  it("each token has the expected shape", async () => {
    const { body } = await fetchJson<Record<string, unknown>[]>("/api/v1/tokens?limit=1&offset=0");
    const token = body.data[0];

    expect(token).toHaveProperty("address");
    expect(token).toHaveProperty("name");
    expect(token).toHaveProperty("ticker");
    expect(token).toHaveProperty("leverage");
    expect(token).toHaveProperty("underlying");
    expect(token).toHaveProperty("status");
    expect(token).toHaveProperty("creator");
    expect(token).toHaveProperty("isHidden");
    expect(token).toHaveProperty("createdAt");
  });

  it("respects limit parameter", async () => {
    const { body } = await fetchJson<unknown[]>("/api/v1/tokens?limit=1&offset=0");
    expect(body.data.length).toBeLessThanOrEqual(1);
  });

  it("filters by status", async () => {
    const { res, body } = await fetchJson<Record<string, unknown>[]>(
      "/api/v1/tokens?status=curve&limit=10&offset=0",
    );
    expect(res.status).toBe(200);
    for (const token of body.data) {
      expect(token.status).toBe("curve");
    }
  });

  it("rejects invalid pagination", async () => {
    const { res } = await fetchJson("/api/v1/tokens?limit=abc");
    expect(res.status).toBe(400);
  });
});

describe("GET /api/v1/tokens/search", () => {
  it("finds tokens by name", async () => {
    const { res, body } = await fetchJson<Record<string, unknown>[]>(
      "/api/v1/tokens/search?q=E2E",
    );
    expect(res.status).toBe(200);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    expect(body.data[0]).toHaveProperty("name");
  });

  it("returns empty array for no matches", async () => {
    const { res, body } = await fetchJson<unknown[]>(
      "/api/v1/tokens/search?q=zzzznonexistent",
    );
    expect(res.status).toBe(200);
    expect(body.data).toEqual([]);
  });

  it("returns empty array for missing query", async () => {
    const { res, body } = await fetchJson<unknown[]>("/api/v1/tokens/search");
    expect(res.status).toBe(200);
    expect(body.data).toEqual([]);
  });
});

describe("GET /api/v1/tokens/:address", () => {
  it("returns token detail for known address", async () => {
    const { res, body } = await fetchJson<Record<string, unknown>>(
      `/api/v1/tokens/${TEST_TOKEN}`,
    );
    expect(res.status).toBe(200);
    expect(body.status).toBe("success");
    expect(body.data.address).toBe(TEST_TOKEN);
    expect(body.data.name).toBe("E2E Test Token");
    expect(body.data.ticker).toBe("E2E");
    expect(body.data).toHaveProperty("curveFilled");
    expect(body.data).toHaveProperty("curveSupply");
    expect(body.data).toHaveProperty("ltReserve");
  });

  it("returns 404 for unknown address", async () => {
    const { res } = await fetchJson(`/api/v1/tokens/${NONEXISTENT_ADDRESS}`);
    expect(res.status).toBe(404);
  });

  it("returns 400 for invalid address", async () => {
    const { res } = await fetchJson("/api/v1/tokens/not-an-address");
    expect(res.status).toBe(400);
  });
});

// ─── Comments (DB) ──────────────────────────────────────────────────

describe("GET /api/v1/tokens/:address/comments", () => {
  it("returns comments for a token", async () => {
    const { res, body } = await fetchJson<Record<string, unknown>[]>(
      `/api/v1/tokens/${TEST_TOKEN}/comments`,
    );
    expect(res.status).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThanOrEqual(1);

    const comment = body.data[0];
    expect(comment).toHaveProperty("id");
    expect(comment).toHaveProperty("content");
    expect(comment).toHaveProperty("author");
    expect(comment).toHaveProperty("tokenAddress");
  });

  it("returns empty array for token with no comments", async () => {
    const { res, body } = await fetchJson<unknown[]>(
      `/api/v1/tokens/${NONEXISTENT_ADDRESS}/comments`,
    );
    expect(res.status).toBe(200);
    expect(body.data).toEqual([]);
  });
});

// ─── Creators (DB + Ponder) ──────────────────────────────────────────

describe("GET /api/v1/creators/:address", () => {
  it("returns creator profile with tokens", async () => {
    const { res, body } = await fetchJson<{
      profile: unknown;
      tokens: Record<string, unknown>[];
      stats: { tokensCreated: number; totalVolume: string };
    }>(`/api/v1/creators/${TEST_CREATOR}`);

    expect(res.status).toBe(200);
    expect(body.data.tokens.length).toBeGreaterThanOrEqual(1);
    expect(body.data.stats.tokensCreated).toBeGreaterThanOrEqual(1);
    expect(body.data.stats).toHaveProperty("totalVolume");
  });

  it("returns empty tokens for unknown creator", async () => {
    const { res, body } = await fetchJson<{
      tokens: unknown[];
      stats: { tokensCreated: number };
    }>(`/api/v1/creators/${NONEXISTENT_ADDRESS}`);

    expect(res.status).toBe(200);
    expect(body.data.tokens).toEqual([]);
    expect(body.data.stats.tokensCreated).toBe(0);
  });

  it("returns 400 for invalid address", async () => {
    const { res } = await fetchJson("/api/v1/creators/bad");
    expect(res.status).toBe(400);
  });
});

// ─── Profiles (DB) ───────────────────────────────────────────────────

describe("GET /api/v1/profiles/:address", () => {
  it("returns default profile for unknown address", async () => {
    const { res, body } = await fetchJson<Record<string, unknown>>(
      `/api/v1/profiles/${NONEXISTENT_ADDRESS}`,
    );
    expect(res.status).toBe(200);
    expect(body.data.address).toBe(NONEXISTENT_ADDRESS);
    expect(body.data.displayName).toBeNull();
    expect(body.data.totalVolume).toBe("0");
    expect(body.data.totalTrades).toBe(0);
  });

  it("returns 400 for invalid address", async () => {
    const { res } = await fetchJson("/api/v1/profiles/bad");
    expect(res.status).toBe(400);
  });
});

// ─── Ponder-dependent endpoints (graceful degradation) ───────────────
// Ponder isn't running in the test environment, so these endpoints should
// degrade gracefully — returning 503 or empty data, never crashing.

describe("Ponder-dependent endpoints degrade gracefully", () => {
  it("GET /api/v1/trades returns 503 when indexer unavailable", async () => {
    const { res, body } = await fetchJson("/api/v1/trades?limit=5");
    expect(res.status).toBe(503);
    expect(body.status).toBe("error");
  });

  it("GET /api/v1/trades/:address returns 503", async () => {
    const { res } = await fetchJson(
      `/api/v1/trades/${TEST_TOKEN}?limit=5&offset=0`,
    );
    expect(res.status).toBe(503);
  });

  it("GET /api/v1/trades/ohlcv/:address returns 503", async () => {
    const { res } = await fetchJson(
      `/api/v1/trades/ohlcv/${TEST_TOKEN}`,
    );
    expect(res.status).toBe(503);
  });

  it("GET /api/v1/trades/sparkline/:address returns empty array", async () => {
    const { res, body } = await fetchJson<unknown[]>(
      `/api/v1/trades/sparkline/${TEST_TOKEN}`,
    );
    expect(res.status).toBe(200);
    expect(body.data).toEqual([]);
  });

  it("GET /api/v1/stats returns degraded data", async () => {
    const { res, body } = await fetchJson<Record<string, unknown>>("/api/v1/stats");
    expect(res.status).toBe(200);
    expect(body.data).toHaveProperty("totalTokens");
    expect(body.data).toHaveProperty("volume24h");
    expect(body.dataSource).toBe("degraded");
  });

  it("GET /api/v1/holders/:address returns 503", async () => {
    const { res } = await fetchJson(`/api/v1/holders/${TEST_TOKEN}`);
    expect(res.status).toBe(503);
  });

  it("GET /api/v1/portfolio/:wallet returns 503", async () => {
    const { res } = await fetchJson(`/api/v1/portfolio/${TEST_CREATOR}`);
    expect(res.status).toBe(503);
  });

  it("GET /api/v1/referrals/:wallet returns empty data", async () => {
    const { res, body } = await fetchJson<Record<string, unknown>>(
      `/api/v1/referrals/${TEST_CREATOR}`,
    );
    expect(res.status).toBe(200);
    expect(body.data).toHaveProperty("referredWallets");
  });

  it("GET /api/v1/security/:address returns fallback data", async () => {
    const { res, body } = await fetchJson<Record<string, unknown>>(
      `/api/v1/security/${TEST_TOKEN}`,
    );
    expect(res.status).toBe(200);
    expect(body.data).toHaveProperty("contractVerified");
  });
});

// ─── Assets (external APIs) ─────────────────────────────────────────

describe("GET /api/v1/assets", () => {
  it("returns underlying and leveraged token prices", async () => {
    const { res, body } = await fetchJson<{
      underlying: unknown[];
      leveragedTokens: unknown[];
    }>("/api/v1/assets");
    expect(res.status).toBe(200);
    expect(Array.isArray(body.data.underlying)).toBe(true);
    expect(Array.isArray(body.data.leveragedTokens)).toBe(true);
  });
});
