import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

import type { AppBindings } from "../lib/types.js";

const mockFetchWalletBotPositions = vi.fn();
const mockFetchTokenBalancesByWalletAndTokens = vi.fn();
const mockFetchLiveLtRatesWithProvenance = vi.fn();
const mockFetchTokensOnchainByAddresses = vi.fn();

vi.mock("../lib/indexer-reads.js", () => ({
  fetchWalletBotPositions: mockFetchWalletBotPositions,
  fetchTokenBalancesByWalletAndTokens: mockFetchTokenBalancesByWalletAndTokens,
}));

// Must mirror exactly what the route imports. Mocking the wrong name
// leaves the import undefined, the call throws, and the route's
// live-mark catch swallows it — so every test silently exercises the
// degraded path and the healthy one goes unverified. Codex review on
// PR #1235.
vi.mock("../lib/market-data.js", () => ({
  fetchLiveLtRatesWithProvenance: mockFetchLiveLtRatesWithProvenance,
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
    // Default: a healthy read that yields no prices, so valuations keep
    // their snapshot values without the response counting as degraded.
    mockFetchLiveLtRatesWithProvenance.mockResolvedValue({
      rates: new Map(),
      stale: false,
    });
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
    // An empty body from a failed read must not hold a real answer's
    // window — it would tell a trader they hold nothing.
    expect(res.headers.get("Cloudflare-CDN-Cache-Control")).toBe(
      "public, max-age=5, stale-while-revalidate=10",
    );
  });

  it("shortens the window when only the on-chain balance read fails", async () => {
    // The positions read succeeded, so this path used to look healthy —
    // but a null balances read zeroes every open position, which is
    // indistinguishable from having sold everything. Codex review on
    // PR #1235.
    mockFetchWalletBotPositions.mockResolvedValue([
      {
        token: TOKEN,
        ticker: "PURR",
        tokenBalance: (1_000n * 10n ** 18n).toString(),
        costBasisUsdc: "100000000",
        currentValueUsdc: "120000000",
        realisedPnlUsdc: "0",
        totalCostUsdc: "100000000",
        totalProceedsUsdc: "0",
      },
    ]);
    mockFetchTokenBalancesByWalletAndTokens.mockResolvedValue(null);

    const res = await createApp().request(`/bot/positions-v2/${WALLET}`, {}, makeEnv());

    expect(res.status).toBe(200);
    expect(res.headers.get("Cloudflare-CDN-Cache-Control")).toBe(
      "public, max-age=5, stale-while-revalidate=10",
    );
  });

  it("shortens the window when the live-mark re-mark fails", async () => {
    // Positions and balances both succeed, so the response looks
    // healthy — but with no live prices the valuations are the indexer's
    // snapshot rather than current ones. Codex review on PR #1235.
    mockFetchWalletBotPositions.mockResolvedValue([
      {
        token: TOKEN,
        ticker: "PURR",
        tokenBalance: (1_000n * 10n ** 18n).toString(),
        costBasisUsdc: "100000000",
        currentValueUsdc: "120000000",
        realisedPnlUsdc: "0",
        totalCostUsdc: "100000000",
        totalProceedsUsdc: "0",
      },
    ]);
    mockFetchTokenBalancesByWalletAndTokens.mockResolvedValue([
      { tokenAddress: TOKEN, balance: (1_000n * 10n ** 18n).toString() },
    ]);
    mockFetchTokensOnchainByAddresses.mockResolvedValue(null);

    const res = await createApp().request(`/bot/positions-v2/${WALLET}`, {}, makeEnv());

    expect(res.status).toBe(200);
    expect(res.headers.get("Cloudflare-CDN-Cache-Control")).toBe(
      "public, max-age=5, stale-while-revalidate=10",
    );
  });

  it("re-marks valuations from live prices and keeps the full window", async () => {
    // The healthy live-mark path, which went unverified while the mock
    // named the wrong export. Asserting the recomputed value is what
    // proves the re-mark actually ran rather than silently throwing.
    const LT = "0xCccc000000000000000000000000000000000003";
    mockFetchWalletBotPositions.mockResolvedValue([
      {
        token: TOKEN,
        ticker: "PURR",
        tokenBalance: (1_000n * 10n ** 18n).toString(),
        costBasisUsdc: "100000000",
        currentValueUsdc: "120000000", // stale snapshot
        realisedPnlUsdc: "0",
        totalCostUsdc: "100000000",
        totalProceedsUsdc: "0",
      },
    ]);
    mockFetchTokenBalancesByWalletAndTokens.mockResolvedValue([
      { tokenAddress: TOKEN, balance: (1_000n * 10n ** 18n).toString() },
    ]);
    // ratio = ltReserve / curveSupply = 1, rate = 1 → price = 1 USDC.
    mockFetchTokensOnchainByAddresses.mockResolvedValue([
      {
        address: TOKEN,
        ltToken: LT,
        curveSupply: (10n ** 18n).toString(),
        ltReserve: (10n ** 18n).toString(),
      },
    ]);
    mockFetchLiveLtRatesWithProvenance.mockResolvedValue({
      rates: new Map([[LT.toLowerCase(), 1]]),
      stale: false,
    });

    const res = await createApp().request(`/bot/positions-v2/${WALLET}`, {}, makeEnv());
    const body = (await res.json()) as {
      data: { open: { currentValueUsdc: string; unrealisedPnlUsdc: string }[] };
    };

    // 1000 tokens at 1 USDC = 1000 USDC, 6dp — not the 120 snapshot.
    expect(body.data.open[0].currentValueUsdc).toBe("1000000000");
    expect(body.data.open[0].unrealisedPnlUsdc).toBe("900000000");
    expect(res.headers.get("Cloudflare-CDN-Cache-Control")).toBe(
      "public, max-age=15, stale-while-revalidate=30",
    );
  });

  it("shortens the window when LT rates came from the expired cache", async () => {
    // Rates are present and usable, so nothing else looks wrong — but
    // they're an arbitrarily old copy kept alive by the fail-open.
    mockFetchWalletBotPositions.mockResolvedValue([
      {
        token: TOKEN,
        ticker: "PURR",
        tokenBalance: (1_000n * 10n ** 18n).toString(),
        costBasisUsdc: "100000000",
        currentValueUsdc: "120000000",
        realisedPnlUsdc: "0",
        totalCostUsdc: "100000000",
        totalProceedsUsdc: "0",
      },
    ]);
    mockFetchTokenBalancesByWalletAndTokens.mockResolvedValue([
      { tokenAddress: TOKEN, balance: (1_000n * 10n ** 18n).toString() },
    ]);
    mockFetchLiveLtRatesWithProvenance.mockResolvedValue({
      rates: new Map([["0xdead", 1]]),
      stale: true,
    });

    const res = await createApp().request(`/bot/positions-v2/${WALLET}`, {}, makeEnv());

    expect(res.status).toBe(200);
    expect(res.headers.get("Cloudflare-CDN-Cache-Control")).toBe(
      "public, max-age=5, stale-while-revalidate=10",
    );
  });

  it("gives a fully successful read the full window", async () => {
    mockFetchWalletBotPositions.mockResolvedValue([]);

    const res = await createApp().request(`/bot/positions-v2/${WALLET}`, {}, makeEnv());

    expect(res.headers.get("Cloudflare-CDN-Cache-Control")).toBe(
      "public, max-age=15, stale-while-revalidate=30",
    );
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
