import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

import type { AppBindings } from "../lib/types.js";

const mockPonderQuery = vi.fn();

vi.mock("../lib/ponder-client.js", () => ({
  createPonderQuery: () => mockPonderQuery,
}));

const { default: botPositions } = await import("../routes/bot/positions.js");

const VALID_WALLET = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const TOKEN_A = "0x1111111111111111111111111111111111111111";
const TOKEN_B = "0x2222222222222222222222222222222222222222";

const makeEnv = (): AppBindings =>
  ({
    DATABASE_URL: "postgres://test",
    BOUNCETECH_DATABASE_URL: "",
    ADMIN_API_KEY: "admin-key",
    PONDER_URL: "http://localhost:42069",
    IMAGES_BUCKET: {} as R2Bucket,
    WEBSOCKET_DO: {} as DurableObjectNamespace,
    WS_IP_LIMITER_DO: {} as DurableObjectNamespace,
    LT_TICKER_DO: {} as DurableObjectNamespace,
  }) as AppBindings;

const createApp = (): Hono<{ Bindings: AppBindings }> => {
  const app = new Hono<{ Bindings: AppBindings }>();
  app.route("/bot/positions", botPositions);
  return app;
};

interface PositionsResponseBody {
  data: {
    open: Array<{
      token: string;
      ticker: string;
      balance: string;
      costBasisUsdc: string;
      currentValueUsdc: string;
      unrealisedPnlUsdc: string;
      unrealisedPnlPct: number | null;
    }>;
    realised: Array<{
      token: string;
      ticker: string;
      totalCostUsdc: string;
      totalProceedsUsdc: string;
      realisedPnlUsdc: string;
      realisedPnlPct: number | null;
    }>;
  };
}

describe("GET /bot/positions/:wallet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPonderQuery.mockResolvedValue({
      walletBotPositions: { items: [] },
    });
  });

  it("rejects an invalid wallet address", async () => {
    const res = await createApp().request(
      "/bot/positions/not-an-address",
      {},
      makeEnv(),
    );
    expect(res.status).toBe(400);
  });

  it("returns empty open/realised when the indexer has no rows", async () => {
    const res = await createApp().request(
      `/bot/positions/${VALID_WALLET}`,
      {},
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as PositionsResponseBody;
    expect(body.data).toEqual({ open: [], realised: [] });
  });

  it("collapses indexer outages to empty data rather than 5xx", async () => {
    mockPonderQuery.mockResolvedValue(null);
    const res = await createApp().request(
      `/bot/positions/${VALID_WALLET}`,
      {},
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as PositionsResponseBody;
    expect(body.data).toEqual({ open: [], realised: [] });
  });

  it("collapses indexer entity-missing GraphQL errors to empty data", async () => {
    // Before the BotFeeRouter indexer migration ships, querying
    // `walletBotPositions` throws a GraphQL "field does not exist"
    // error. Route must absorb that and return empty arrays.
    mockPonderQuery.mockRejectedValue(new Error("Unknown field"));
    const res = await createApp().request(
      `/bot/positions/${VALID_WALLET}`,
      {},
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as PositionsResponseBody;
    expect(body.data).toEqual({ open: [], realised: [] });
  });

  it("classifies open vs realised by tokenBalance>0 / totalProceeds>0", async () => {
    mockPonderQuery.mockResolvedValue({
      walletBotPositions: {
        items: [
          // Currently held, never sold → only open.
          {
            token: TOKEN_A,
            ticker: "ONE",
            tokenBalance: "1500000000000000000",
            costBasisUsdc: "20000000",
            currentValueUsdc: "25000000",
            realisedPnlUsdc: "0",
            totalCostUsdc: "20000000",
            totalProceedsUsdc: "0",
          },
          // Fully sold, no current balance → only realised.
          {
            token: TOKEN_B,
            ticker: "TWO",
            tokenBalance: "0",
            costBasisUsdc: "0",
            currentValueUsdc: "0",
            realisedPnlUsdc: "5000000",
            totalCostUsdc: "10000000",
            totalProceedsUsdc: "15000000",
          },
        ],
      },
    });
    const res = await createApp().request(
      `/bot/positions/${VALID_WALLET}`,
      {},
      makeEnv(),
    );
    const body = (await res.json()) as PositionsResponseBody;
    expect(body.data.open).toHaveLength(1);
    expect(body.data.realised).toHaveLength(1);
    expect(body.data.open[0]!.token).toBe(TOKEN_A);
    expect(body.data.realised[0]!.token).toBe(TOKEN_B);
  });

  it("derives unrealised PnL and percent from cost basis and current value", async () => {
    mockPonderQuery.mockResolvedValue({
      walletBotPositions: {
        items: [
          {
            token: TOKEN_A,
            ticker: "ONE",
            tokenBalance: "1000",
            costBasisUsdc: "20000000",
            currentValueUsdc: "25000000",
            realisedPnlUsdc: "0",
            totalCostUsdc: "20000000",
            totalProceedsUsdc: "0",
          },
        ],
      },
    });
    const res = await createApp().request(
      `/bot/positions/${VALID_WALLET}`,
      {},
      makeEnv(),
    );
    const body = (await res.json()) as PositionsResponseBody;
    expect(body.data.open[0]!.unrealisedPnlUsdc).toBe("5000000");
    expect(body.data.open[0]!.unrealisedPnlPct).toBe(25);
  });

  it("renders unrealisedPnlPct as null when cost basis is zero (airdropped position)", async () => {
    mockPonderQuery.mockResolvedValue({
      walletBotPositions: {
        items: [
          {
            token: TOKEN_A,
            ticker: "ONE",
            tokenBalance: "1000",
            costBasisUsdc: "0",
            currentValueUsdc: "5000000",
            realisedPnlUsdc: "0",
            totalCostUsdc: "0",
            totalProceedsUsdc: "0",
          },
        ],
      },
    });
    const res = await createApp().request(
      `/bot/positions/${VALID_WALLET}`,
      {},
      makeEnv(),
    );
    const body = (await res.json()) as PositionsResponseBody;
    expect(body.data.open[0]!.unrealisedPnlPct).toBeNull();
  });

  it("emits a negative unrealised PnL with leading minus when current value < cost", async () => {
    mockPonderQuery.mockResolvedValue({
      walletBotPositions: {
        items: [
          {
            token: TOKEN_A,
            ticker: "ONE",
            tokenBalance: "1000",
            costBasisUsdc: "20000000",
            currentValueUsdc: "12000000",
            realisedPnlUsdc: "0",
            totalCostUsdc: "20000000",
            totalProceedsUsdc: "0",
          },
        ],
      },
    });
    const res = await createApp().request(
      `/bot/positions/${VALID_WALLET}`,
      {},
      makeEnv(),
    );
    const body = (await res.json()) as PositionsResponseBody;
    expect(body.data.open[0]!.unrealisedPnlUsdc).toBe("-8000000");
    expect(body.data.open[0]!.unrealisedPnlPct).toBe(-40);
  });

  it("sorts open by |unrealised PnL| desc and realised by realised PnL desc", async () => {
    mockPonderQuery.mockResolvedValue({
      walletBotPositions: {
        items: [
          {
            token: TOKEN_A,
            ticker: "ONE",
            tokenBalance: "1000",
            costBasisUsdc: "10000000",
            currentValueUsdc: "11000000", // +$1
            realisedPnlUsdc: "0",
            totalCostUsdc: "10000000",
            totalProceedsUsdc: "0",
          },
          {
            token: TOKEN_B,
            ticker: "TWO",
            tokenBalance: "1000",
            costBasisUsdc: "10000000",
            currentValueUsdc: "5000000", // -$5
            realisedPnlUsdc: "0",
            totalCostUsdc: "10000000",
            totalProceedsUsdc: "0",
          },
        ],
      },
    });
    const res = await createApp().request(
      `/bot/positions/${VALID_WALLET}`,
      {},
      makeEnv(),
    );
    const body = (await res.json()) as PositionsResponseBody;
    expect(body.data.open[0]!.token).toBe(TOKEN_B); // |-5| > |+1|
    expect(body.data.open[1]!.token).toBe(TOKEN_A);
  });

  it("ignores malformed rows without crashing the response", async () => {
    mockPonderQuery.mockResolvedValue({
      walletBotPositions: {
        items: [
          null,
          { token: 123 }, // wrong types
          {
            token: TOKEN_A,
            ticker: "ONE",
            tokenBalance: "1000",
            costBasisUsdc: "10000000",
            currentValueUsdc: "11000000",
            realisedPnlUsdc: "0",
            totalCostUsdc: "10000000",
            totalProceedsUsdc: "0",
          },
        ],
      },
    });
    const res = await createApp().request(
      `/bot/positions/${VALID_WALLET}`,
      {},
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as PositionsResponseBody;
    expect(body.data.open).toHaveLength(1);
    expect(body.data.open[0]!.token).toBe(TOKEN_A);
  });
});
