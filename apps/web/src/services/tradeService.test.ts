import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./api", () => ({
  fetchHolders: vi.fn(),
}));

vi.mock("./tradeFeed", () => ({
  subscribeFeed: vi.fn(() => () => {}),
  subscribeTokenTrades: vi.fn(() => () => {}),
}));

const { fetchHolders } = await import("./api");
const { tradeService } = await import("./tradeService");

const ONE = 10n ** 18n;
const TOKEN_ADDR = "0x4DFB6bebbdF9d5ea76123729E0b3a823f9c3ecC0";

describe("tradeService.getHolders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("filters out zero-balance holders client-side (issue #421)", async () => {
    // The API already excludes balance=0 rows (see
    // `apps/api/src/routes/holders.ts`), but a stale / regressed API
    // response could resurface them. Defence-in-depth: drop them here
    // too so the UI never renders a "0.0 tokens / 0%" row, and rank the
    // remaining holders contiguously (no gap where the zero-balance row
    // would have been).
    vi.mocked(fetchHolders).mockResolvedValue({
      holders: [
        { wallet: "0xaaaa000000000000000000000000000000000001", balance: (50_000_000n * ONE).toString(), percentage: 5 },
        { wallet: "0xbbbb000000000000000000000000000000000002", balance: "0", percentage: 0 },
        { wallet: "0xcccc000000000000000000000000000000000003", balance: (1_000n * ONE).toString(), percentage: 0 },
      ],
      totalHolders: 3,
    });

    const result = await tradeService.getHolders(TOKEN_ADDR);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ rank: 1, percentSupply: 5 });
    expect(result[1]).toMatchObject({ rank: 2 });
    // No holder with the zero-balance wallet's prefix should be present.
    expect(result.find((h) => h.address.startsWith("0xbb"))).toBeUndefined();
  });

  it("returns rank-1-indexed holders with truncated wallet addresses", async () => {
    vi.mocked(fetchHolders).mockResolvedValue({
      holders: [
        { wallet: "0x1234000000000000000000000000000000005678", balance: ONE.toString(), percentage: 1 },
      ],
      totalHolders: 1,
    });

    const result = await tradeService.getHolders(TOKEN_ADDR);

    expect(result).toEqual([
      {
        rank: 1,
        address: "0x12…78",
        tokens: "1.0",
        percentSupply: 1,
        isCreator: false,
      },
    ]);
  });

  it("ignores rows with malformed bigint balances rather than throwing", async () => {
    vi.mocked(fetchHolders).mockResolvedValue({
      holders: [
        { wallet: "0xaaaa000000000000000000000000000000000001", balance: (10n * ONE).toString(), percentage: 0 },
        { wallet: "0xbbbb000000000000000000000000000000000002", balance: "not-a-number", percentage: 0 },
      ],
      totalHolders: 2,
    });

    const result = await tradeService.getHolders(TOKEN_ADDR);

    expect(result).toHaveLength(1);
    expect(result[0].rank).toBe(1);
  });

  it("returns [] when the API call rejects", async () => {
    vi.mocked(fetchHolders).mockRejectedValue(new Error("boom"));
    expect(await tradeService.getHolders(TOKEN_ADDR)).toEqual([]);
  });
});
