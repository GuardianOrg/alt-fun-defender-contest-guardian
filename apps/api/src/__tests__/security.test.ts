import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

import type { AppBindings } from "../lib/types.js";

const mockPonderQuery = vi.fn();

vi.mock("../lib/ponder-client.js", () => ({
  createPonderQuery: () => mockPonderQuery,
}));

const { default: securityRoute } = await import("../routes/security.js");

function createApp() {
  const app = new Hono<{ Bindings: AppBindings }>();
  app.route("/security", securityRoute);
  return app;
}

function makeEnv(): AppBindings {
  return {
    DATABASE_URL: "postgres://test",
    BOUNCETECH_DATABASE_URL: "",
    ADMIN_API_KEY: "admin-key",
    PONDER_URL: "http://localhost:42069",
    IMAGES_BUCKET: {} as R2Bucket,
    WEBSOCKET_DO: {} as DurableObjectNamespace,
    LT_TICKER_DO: {} as DurableObjectNamespace,
    AI: {} as Ai,
  };
}

const TOKEN = "0xaaaa000000000000000000000000000000000001";
const CREATOR = "0xbbbb000000000000000000000000000000000002";
const PAIR = "0xcccc000000000000000000000000000000000003";

const ONE = 10n ** 18n;
const TOTAL_SUPPLY = 1_000_000_000n * ONE;

describe("GET /security/:address", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 for an invalid address", async () => {
    const app = createApp();
    const res = await app.request("/security/not-an-address", {}, makeEnv());
    expect(res.status).toBe(400);
  });

  it("returns the neutral fallback (200) when the indexer is unreachable", async () => {
    // Match the legacy contract — terminal-API consumers and the smoke test
    // both expect 200 here, and a brief Ponder outage shouldn't blank the
    // security panel. `creatorHoldingPct: 0` is the safest default for a
    // security screen anyway.
    mockPonderQuery.mockResolvedValue(null);
    const app = createApp();
    const res = await app.request(`/security/${TOKEN}`, {}, makeEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { creatorHoldingPct: number } };
    expect(body.data.creatorHoldingPct).toBe(0);
  });

  it("returns the fallback shape when the token is not yet indexed", async () => {
    mockPonderQuery.mockResolvedValue({ token: null, graduation: null });

    const app = createApp();
    const res = await app.request(`/security/${TOKEN}`, {}, makeEnv());

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

  it("derives creatorHoldingPct from a single tokenBalance lookup", async () => {
    mockPonderQuery
      .mockResolvedValueOnce({
        token: { creator: CREATOR, graduated: false, hyperswapPair: null },
        graduation: null,
      })
      .mockResolvedValueOnce({
        // 5% of total supply
        tokenBalance: { balance: (TOTAL_SUPPLY / 20n).toString() },
      });

    const app = createApp();
    const res = await app.request(`/security/${TOKEN}`, {}, makeEnv());

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        creatorHoldingPct: number;
        lpLocked: boolean;
        graduated: boolean;
        poolAddress: string | null;
      };
    };
    expect(body.data.creatorHoldingPct).toBe(5);
    expect(body.data.lpLocked).toBe(false);
    expect(body.data.graduated).toBe(false);
    expect(body.data.poolAddress).toBeNull();
  });

  it("looks up the creator's balance row by composite primary key", async () => {
    mockPonderQuery
      .mockResolvedValueOnce({
        token: { creator: CREATOR, graduated: false, hyperswapPair: null },
        graduation: null,
      })
      .mockResolvedValueOnce({ tokenBalance: null });

    const app = createApp();
    await app.request(`/security/${TOKEN}`, {}, makeEnv());

    const [, vars] = mockPonderQuery.mock.calls[1] as [string, { id: string }];
    expect(vars.id).toBe(`${CREATOR.toLowerCase()}-${TOKEN.toLowerCase()}`);
  });

  it("queries Ponder with the correct primary-key arg names (token.address, graduation.tokenAddress)", async () => {
    // Regression guard: the legacy implementation used `token(id: ...)` and
    // `graduation(id: ...)`, both of which are silently rejected by Ponder's
    // GraphQL validator (which mirrors the schema's primary-key column name).
    // That bug made /security always return the neutral fallback regardless
    // of indexer state.
    mockPonderQuery
      .mockResolvedValueOnce({
        token: { creator: CREATOR, graduated: false, hyperswapPair: null },
        graduation: null,
      })
      .mockResolvedValueOnce({ tokenBalance: null });

    const app = createApp();
    await app.request(`/security/${TOKEN}`, {}, makeEnv());

    const [metadataQuery] = mockPonderQuery.mock.calls[0] as [string];
    expect(metadataQuery).toContain("token(address: $address)");
    expect(metadataQuery).toContain("graduation(tokenAddress: $address)");
    expect(metadataQuery).not.toContain("token(id:");
    expect(metadataQuery).not.toContain("graduation(id:");
  });

  it("treats a missing balance row as zero (creator has never held the token)", async () => {
    mockPonderQuery
      .mockResolvedValueOnce({
        token: { creator: CREATOR, graduated: false, hyperswapPair: null },
        graduation: null,
      })
      .mockResolvedValueOnce({ tokenBalance: null });

    const app = createApp();
    const res = await app.request(`/security/${TOKEN}`, {}, makeEnv());
    const body = (await res.json()) as { data: { creatorHoldingPct: number } };
    expect(body.data.creatorHoldingPct).toBe(0);
  });

  it("flags lpLocked when the token is graduated and a graduation row exists", async () => {
    mockPonderQuery
      .mockResolvedValueOnce({
        token: { creator: CREATOR, graduated: true, hyperswapPair: PAIR },
        graduation: { liquidity: "12345" },
      })
      .mockResolvedValueOnce({ tokenBalance: null });

    const app = createApp();
    const res = await app.request(`/security/${TOKEN}`, {}, makeEnv());
    const body = (await res.json()) as {
      data: { lpLocked: boolean; lpAmount: string | null; poolAddress: string | null };
    };
    expect(body.data.lpLocked).toBe(true);
    expect(body.data.lpAmount).toBe("12345");
    expect(body.data.poolAddress).toBe(PAIR);
  });

  it("issues exactly two GraphQL round-trips (metadata + creator balance)", async () => {
    mockPonderQuery
      .mockResolvedValueOnce({
        token: { creator: CREATOR, graduated: false, hyperswapPair: null },
        graduation: null,
      })
      .mockResolvedValueOnce({ tokenBalance: null });

    const app = createApp();
    await app.request(`/security/${TOKEN}`, {}, makeEnv());
    expect(mockPonderQuery).toHaveBeenCalledTimes(2);
  });

  it("sets a Cache-Control header on the success path", async () => {
    mockPonderQuery
      .mockResolvedValueOnce({
        token: { creator: CREATOR, graduated: false, hyperswapPair: null },
        graduation: null,
      })
      .mockResolvedValueOnce({ tokenBalance: null });

    const app = createApp();
    const res = await app.request(`/security/${TOKEN}`, {}, makeEnv());
    expect(res.headers.get("Cache-Control")).toContain("s-maxage=30");
  });
});
