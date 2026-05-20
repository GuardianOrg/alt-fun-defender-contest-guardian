import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

import type { AppBindings } from "../lib/types.js";

const mockFetchTokenAndGraduation = vi.fn();
const mockFetchTokenBalanceById = vi.fn();

vi.mock("../lib/indexer-reads.js", () => ({
  fetchTokenAndGraduationForSecurity: mockFetchTokenAndGraduation,
  fetchTokenBalanceById: mockFetchTokenBalanceById,
}));

vi.mock("../db/client.js", () => ({
  createDb: () => ({}),
}));

const { default: securityV2 } = await import("../routes/security-v2.js");

function createApp() {
  const app = new Hono<{ Bindings: AppBindings }>();
  app.route("/security-v2", securityV2);
  return app;
}

function makeEnv(): AppBindings {
  return {
    HYPERDRIVE: { connectionString: "postgres://hyperdrive-test" } as unknown as Hyperdrive,
    DATABASE_URL: "postgres://test",
    BOUNCETECH_DATABASE_URL: "",
    ADMIN_API_KEY: "admin-key",
    IMAGES_BUCKET: {} as R2Bucket,
    WEBSOCKET_DO: {} as DurableObjectNamespace,
    WS_IP_LIMITER_DO: {} as DurableObjectNamespace,
    LT_TICKER_DO: {} as DurableObjectNamespace,
    LT_DIRECTORY_POLLER_DO: {} as DurableObjectNamespace,
  };
}

const TOKEN = "0x4DFB6bebbdF9d5ea76123729E0b3a823f9c3ecC0";

describe("GET /security-v2/:address", () => {
  beforeEach(() => vi.clearAllMocks());

  it("400 for malformed address", async () => {
    const res = await createApp().request("/security-v2/nope", {}, makeEnv());
    expect(res.status).toBe(400);
  });

  it("returns neutral fallback (200) when token row is missing", async () => {
    mockFetchTokenAndGraduation.mockResolvedValue(null);
    const res = await createApp().request(`/security-v2/${TOKEN}`, {}, makeEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { lpLocked: boolean; creatorHoldingPct: number; contractVerified: boolean };
    };
    expect(body.data).toEqual({
      lpLocked: false,
      creatorHoldingPct: 0,
      contractVerified: true,
    });
  });

  it("returns neutral fallback (200) when indexer errors — matches v1", async () => {
    mockFetchTokenAndGraduation.mockResolvedValue("unavailable");
    const res = await createApp().request(`/security-v2/${TOKEN}`, {}, makeEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { creatorHoldingPct: number } };
    expect(body.data.creatorHoldingPct).toBe(0);
  });

  it("computes creatorHoldingPct from the balance row and surfaces graduation fields", async () => {
    mockFetchTokenAndGraduation.mockResolvedValue({
      creator: "0xaaa0000000000000000000000000000000000001",
      graduated: true,
      hyperswapPair: "0xPAIR",
      graduation: { liquidity: "12345" },
    });
    // 250M tokens out of 1B totalSupply = 25%
    mockFetchTokenBalanceById.mockResolvedValue({
      balance: (250_000_000n * 10n ** 18n).toString(),
    });

    const res = await createApp().request(`/security-v2/${TOKEN}`, {}, makeEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        lpLocked: boolean;
        lpAmount: string | null;
        creatorHoldingPct: number;
        graduated: boolean;
        poolAddress: string | null;
      };
    };
    expect(body.data.lpLocked).toBe(true);
    expect(body.data.lpAmount).toBe("12345");
    expect(body.data.creatorHoldingPct).toBe(25);
    expect(body.data.graduated).toBe(true);
    expect(body.data.poolAddress).toBe("0xPAIR");
  });

  it("treats a missing creator balance row as 0% holdings", async () => {
    mockFetchTokenAndGraduation.mockResolvedValue({
      creator: "0xaaa0000000000000000000000000000000000001",
      graduated: false,
      hyperswapPair: null,
      graduation: null,
    });
    mockFetchTokenBalanceById.mockResolvedValue(null);
    const res = await createApp().request(`/security-v2/${TOKEN}`, {}, makeEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { creatorHoldingPct: number } };
    expect(body.data.creatorHoldingPct).toBe(0);
  });
});

// Issue #942: the canonical `/api/v1/security` mount now serves the v2
// handler directly. Pin that wiring so a future refactor that drops the
// canonical mount lights up here instead of silently 404-ing external
// callers still on the legacy path.
describe("GET /security/:address (canonical path served by v2 handler)", () => {
  beforeEach(() => vi.clearAllMocks());

  function createCanonicalApp() {
    const app = new Hono<{ Bindings: AppBindings }>();
    app.route("/security", securityV2);
    return app;
  }

  it("returns the v2 response shape on the canonical path", async () => {
    mockFetchTokenAndGraduation.mockResolvedValue(null);
    const res = await createCanonicalApp().request(
      `/security/${TOKEN}`,
      {},
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { lpLocked: boolean; creatorHoldingPct: number; contractVerified: boolean };
    };
    expect(body.data).toEqual({
      lpLocked: false,
      creatorHoldingPct: 0,
      contractVerified: true,
    });
  });
});
