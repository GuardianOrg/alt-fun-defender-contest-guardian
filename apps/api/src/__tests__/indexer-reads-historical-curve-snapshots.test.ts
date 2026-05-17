import { beforeEach, describe, expect, it, vi } from "vitest";

// Capture the SQL tag's `(strings, ...values)` calls so we can assert the
// raw `neon()` tag is invoked with the address array as a template
// parameter — the regression here is drizzle-orm/neon-http serialising the
// JS array as a scalar, which made the `::text[]` cast fail with PG
// `22P02 malformed array literal` and dropped every old-token `change24h`
// to null. Raw `neon()` passes the array straight through.
const mockNeonQuery = vi.fn();
const mockNeonFactory = vi.fn((_url: string) => mockNeonQuery);
vi.mock("@neondatabase/serverless", () => ({
  neon: (url: string) => mockNeonFactory(url),
}));

const { fetchHistoricalCurveSnapshots } = await import(
  "../lib/indexer-reads.js"
);

const DATABASE_URL = "postgres://test";
const CUTOFF_SEC = 1_700_000_000;
const ADDR_A = "0xAaaa00000000000000000000000000000000aaaa";
const ADDR_B = "0xbbbb00000000000000000000000000000000bbbb";

describe("fetchHistoricalCurveSnapshots — array binding", () => {
  beforeEach(() => {
    mockNeonQuery.mockReset();
    mockNeonFactory.mockClear();
  });

  it("invokes the raw neon SQL tag with the lowercased address array as a template parameter", async () => {
    mockNeonQuery.mockResolvedValueOnce([]);

    await fetchHistoricalCurveSnapshots(
      DATABASE_URL,
      [ADDR_A, ADDR_B],
      CUTOFF_SEC,
    );

    // `neon(DATABASE_URL)` is the entry point — drizzle's
    // `db.execute(sql`...`)` would never reach `neon()` directly and
    // would re-introduce the array-bind bug.
    expect(mockNeonFactory).toHaveBeenCalledWith(DATABASE_URL);
    expect(mockNeonQuery).toHaveBeenCalledTimes(1);

    // Template tag calls: first arg is the strings array, subsequent args
    // are interpolated values in order — `${lowered}` then `${cutoffSec}`.
    const call = mockNeonQuery.mock.calls[0];
    const [, loweredArg, cutoffArg] = call as [
      readonly string[],
      string[],
      number,
    ];

    expect(loweredArg).toEqual([
      ADDR_A.toLowerCase(),
      ADDR_B.toLowerCase(),
    ]);
    expect(cutoffArg).toBe(CUTOFF_SEC);
  });

  it("maps rows into a lowercased-keyed snapshot map", async () => {
    mockNeonQuery.mockResolvedValueOnce([
      {
        token_address: ADDR_A.toLowerCase(),
        curve_supply: "123",
        lt_reserve: "456",
        timestamp: "1699999000",
      },
    ]);

    const result = await fetchHistoricalCurveSnapshots(
      DATABASE_URL,
      [ADDR_A, ADDR_B],
      CUTOFF_SEC,
    );

    expect(result).not.toBeNull();
    expect(result!.get(ADDR_A.toLowerCase())).toEqual({
      curveSupply: "123",
      ltReserve: "456",
      timestamp: "1699999000",
    });
    // Seeded null for addresses with no snapshot row before the cutoff —
    // the buildPastPriceInputs fallback then uses the live curve state
    // (no snapshot, but the upstream query still succeeded).
    expect(result!.get(ADDR_B.toLowerCase())).toBeNull();
  });

  it("returns null when the upstream query throws — the whole-batch failure that surfaces as dataSource: degraded", async () => {
    mockNeonQuery.mockRejectedValueOnce(
      Object.assign(new Error("malformed array literal"), { code: "22P02" }),
    );

    const result = await fetchHistoricalCurveSnapshots(
      DATABASE_URL,
      [ADDR_A],
      CUTOFF_SEC,
    );

    expect(result).toBeNull();
  });

  it("short-circuits on an empty address list without hitting the SQL tag", async () => {
    const result = await fetchHistoricalCurveSnapshots(
      DATABASE_URL,
      [],
      CUTOFF_SEC,
    );

    expect(result).not.toBeNull();
    expect(result!.size).toBe(0);
    expect(mockNeonQuery).not.toHaveBeenCalled();
  });
});
