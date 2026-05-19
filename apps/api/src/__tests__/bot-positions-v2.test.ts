import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

import type { AppBindings } from "../lib/types.js";

const mockFetchWalletBotPositions = vi.fn();
const mockFetchTokenBalancesByWalletAndTokens = vi.fn();
const mockFetchLiveLtRates = vi.fn();
const mockFetchTokensOnchainByAddresses = vi.fn();

vi.mock("../lib/indexer-reads.js", () => ({
  fetchWalletBotPositions: mockFetchWalletBotPositions,
  fetchTokenBalancesByWalletAndTokens: mockFetchTokenBalancesByWalletAndTokens,
}));

vi.mock("../lib/market-data.js", () => ({
  fetchLiveLtRates: mockFetchLiveLtRates,
  fetchTokensOnchainByAddresses: mockFetchTokensOnchainByAddresses,
}));

vi.mock("../db/client.js", () => ({
  createDb: () => ({}),
}));

const { default: positionsV2 } = await import("../routes/bot/positions-v2.js");

function createApp() {
  const app = new Hono<{ Bindings: AppBindings }>();
  app.route("/bot/positions-v2", positionsV2);
  return app;
}

function makeEnv(): AppBindings {
  return {
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

const WALLET = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const TOKEN = "0x000000000000000000000000000000000000beef";

describe("GET /bot/positions-v2/:wallet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no live-mark refresh data so we exercise the snapshot path.
    mockFetchLiveLtRates.mockResolvedValue(new Map());
    mockFetchTokensOnchainByAddresses.mockResolvedValue([]);
  });

  it("400 for malformed wallet", async () => {
    const res = await createApp().request("/bot/positions-v2/nope", {}, makeEnv());
    expect(res.status).toBe(400);
  });

  it("returns empty arrays when the helper returns null (collapsed-error path)", async () => {
    mockFetchWalletBotPositions.mockResolvedValue(null);
    const res = await createApp().request(`/bot/positions-v2/${WALLET}`, {}, makeEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { open: unknown[]; realised: unknown[] } };
    expect(body.data.open).toEqual([]);
    expect(body.data.realised).toEqual([]);
  });

  it("returns an open + realised entry when the wallet has both", async () => {
    mockFetchWalletBotPositions.mockResolvedValue([
      {
        token: TOKEN,
        ticker: "PURR",
        tokenBalance: (1_000n * 10n ** 18n).toString(),
        costBasisUsdc: "100000000", // 100 USDC
        currentValueUsdc: "120000000", // 120 USDC snapshot
        realisedPnlUsdc: "10000000", // +10 USDC realised
        totalCostUsdc: "200000000",
        totalProceedsUsdc: "210000000",
      },
    ]);
    // On-chain balance equals router balance — no rescale.
    mockFetchTokenBalancesByWalletAndTokens.mockResolvedValue([
      { tokenAddress: TOKEN, balance: (1_000n * 10n ** 18n).toString() },
    ]);

    const res = await createApp().request(`/bot/positions-v2/${WALLET}`, {}, makeEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        open: { token: string; balance: string; costBasisUsdc: string; unrealisedPnlUsdc: string }[];
        realised: { token: string; realisedPnlUsdc: string }[];
      };
    };
    expect(body.data.open).toHaveLength(1);
    expect(body.data.open[0].token).toBe(TOKEN);
    expect(body.data.open[0].balance).toBe((1_000n * 10n ** 18n).toString());
    expect(body.data.open[0].costBasisUsdc).toBe("100000000");
    expect(body.data.open[0].unrealisedPnlUsdc).toBe("20000000"); // 120 - 100
    expect(body.data.realised).toHaveLength(1);
    expect(body.data.realised[0].realisedPnlUsdc).toBe("10000000");
  });

  it("drops phantom rows where router balance > 0 but chain balance is 0", async () => {
    mockFetchWalletBotPositions.mockResolvedValue([
      {
        token: TOKEN,
        ticker: "GHOST",
        tokenBalance: (1_000n * 10n ** 18n).toString(),
        costBasisUsdc: "1",
        currentValueUsdc: "1",
        realisedPnlUsdc: "0",
        totalCostUsdc: "0",
        totalProceedsUsdc: "0",
      },
    ]);
    // No chain balance returned for this token — phantom.
    mockFetchTokenBalancesByWalletAndTokens.mockResolvedValue([]);

    const res = await createApp().request(`/bot/positions-v2/${WALLET}`, {}, makeEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { open: unknown[]; realised: unknown[] } };
    expect(body.data.open).toEqual([]);
    expect(body.data.realised).toEqual([]);
  });
});
