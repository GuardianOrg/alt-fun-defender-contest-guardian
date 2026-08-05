import { describe, it, expect, vi, beforeEach } from "vitest";

const mockNeonQuery = vi.fn();
vi.mock("@neondatabase/serverless", () => ({
  neon: () => mockNeonQuery,
}));

const {
  fetchLatestLtRate,
  fetchLtRateSeries,
  fetchLtRateSeriesCached,
  quantiseDown,
} = await import("../lib/lt-rate-reads.js");

const DB_URL = "postgres://bouncetech";
const LT = "0xB5A5EcA6Ddc738943A6CaF716D4185B3680dE4b7";

/** Concatenated SQL of the n-th call, for asserting which query ran. */
function sqlOf(callIndex: number): string {
  const [strings] = mockNeonQuery.mock.calls[callIndex]! as [
    TemplateStringsArray,
  ];
  return strings.join("");
}

describe("quantiseDown", () => {
  it("snaps onto an epoch-anchored lattice, not onto the input", () => {
    // Two timestamps inside the same 20s cell must collapse to one value —
    // that identity is what makes the memo below hit across requests.
    expect(quantiseDown(1_700_000_005, 20)).toBe(1_700_000_000);
    expect(quantiseDown(1_700_000_019, 20)).toBe(1_700_000_000);
    expect(quantiseDown(1_700_000_020, 20)).toBe(1_700_000_020);
  });

  it("is a no-op on a step of 1", () => {
    expect(quantiseDown(1_700_000_007, 1)).toBe(1_700_000_007);
  });

  it("leaves values already on the lattice untouched", () => {
    expect(quantiseDown(1_700_000_000, 1_200)).toBe(1_699_999_200);
    expect(quantiseDown(1_699_999_200, 1_200)).toBe(1_699_999_200);
  });
});

describe("fetchLtRateSeries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNeonQuery.mockResolvedValue([]);
  });

  it("samples the window with a generate_series grid", async () => {
    await fetchLtRateSeries(DB_URL, LT, 1_000, 2_000, 20);

    expect(mockNeonQuery).toHaveBeenCalledTimes(1);
    const sql = sqlOf(0);
    expect(sql).toContain("generate_series");
    expect(sql).toContain("token_snapshots_v1");
    expect(sql).toContain("tick_timestamp <= s.t");
  });

  it("binds the window and step as query values", async () => {
    await fetchLtRateSeries(DB_URL, LT, 1_000, 2_000, 20);

    const values = mockNeonQuery.mock.calls[0]!.slice(1);
    expect(values).toContain(1_000);
    expect(values).toContain(2_000);
    expect(values).toContain(20);
    expect(values).toContain(LT);
  });
});

describe("fetchLtRateSeriesCached", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNeonQuery.mockResolvedValue([
      { ts: "1000", exchange_rate: "1000000000000000000" },
    ]);
  });

  it("serves a repeat read of the same window from the memo", async () => {
    const first = await fetchLtRateSeriesCached(DB_URL, LT, 1_000, 2_000, 20);
    const second = await fetchLtRateSeriesCached(DB_URL, LT, 1_000, 2_000, 20);

    expect(mockNeonQuery).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it("treats the LT address case-insensitively", async () => {
    await fetchLtRateSeriesCached(DB_URL, LT, 1_000, 2_000, 20);
    await fetchLtRateSeriesCached(DB_URL, LT.toLowerCase(), 1_000, 2_000, 20);

    expect(mockNeonQuery).toHaveBeenCalledTimes(1);
  });

  it("re-reads once any part of the window changes", async () => {
    await fetchLtRateSeriesCached(DB_URL, LT, 1_000, 2_000, 20);
    await fetchLtRateSeriesCached(DB_URL, LT, 1_000, 2_020, 20);
    await fetchLtRateSeriesCached(DB_URL, LT, 980, 2_000, 20);
    await fetchLtRateSeriesCached(DB_URL, LT, 1_000, 2_000, 100);

    expect(mockNeonQuery).toHaveBeenCalledTimes(4);
  });

  it("coalesces concurrent reads of the same window into one query", async () => {
    await Promise.all([
      fetchLtRateSeriesCached(DB_URL, LT, 1_000, 2_000, 20),
      fetchLtRateSeriesCached(DB_URL, LT, 1_000, 2_000, 20),
      fetchLtRateSeriesCached(DB_URL, LT, 1_000, 2_000, 20),
    ]);

    expect(mockNeonQuery).toHaveBeenCalledTimes(1);
  });

  it("does not pin a failed read — the next caller retries", async () => {
    mockNeonQuery.mockRejectedValueOnce(new Error("neon down"));

    await expect(
      fetchLtRateSeriesCached(DB_URL, LT, 1_000, 2_000, 20),
    ).rejects.toThrow("neon down");

    const rows = await fetchLtRateSeriesCached(DB_URL, LT, 1_000, 2_000, 20);
    expect(rows).toHaveLength(1);
    expect(mockNeonQuery).toHaveBeenCalledTimes(2);
  });
});

describe("fetchLatestLtRate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("seeks the newest tick with no upper time bound", async () => {
    mockNeonQuery.mockResolvedValue([
      { ts: "2100", exchange_rate: "3000000000000000000" },
    ]);

    const row = await fetchLatestLtRate(DB_URL, LT);

    expect(row).toEqual({ ts: "2100", exchange_rate: "3000000000000000000" });
    const sql = sqlOf(0);
    expect(sql).not.toContain("generate_series");
    expect(sql).toContain("ORDER BY tick_timestamp DESC");
    expect(sql).toContain("LIMIT 1");
  });

  it("returns null for an LT with no ticks", async () => {
    mockNeonQuery.mockResolvedValue([]);

    expect(await fetchLatestLtRate(DB_URL, LT)).toBeNull();
  });

  it("is not memoised — the anchor rate must reflect the latest write", async () => {
    mockNeonQuery.mockResolvedValue([
      { ts: "2100", exchange_rate: "3000000000000000000" },
    ]);

    await fetchLatestLtRate(DB_URL, LT);
    await fetchLatestLtRate(DB_URL, LT);

    expect(mockNeonQuery).toHaveBeenCalledTimes(2);
  });
});
