import { describe, it, expect, vi, beforeEach } from "vitest";

// Each helper acquires a fresh db client via `createDb`. We reset the
// chain on every test so a previous test's stubbed `.then()` resolution
// can't leak into the next.
const buildSelectChain = (resolveTo: unknown, reject?: Error) => {
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.orderBy = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
  chain.then = vi.fn((onFulfilled, onRejected) => {
    if (reject) {
      return Promise.resolve().then(() => {
        if (onRejected) return onRejected(reject);
        throw reject;
      });
    }
    return Promise.resolve(resolveTo).then(onFulfilled, onRejected);
  });
  return chain;
};

const mockSelect = vi.fn();

vi.mock("../db/client.js", () => ({
  createDb: () => ({ select: mockSelect }),
}));

const {
  readLtDirectory,
  readSupportedLtDirectory,
  readLiveLtRates,
  readLtByAddress,
  readDirectoryLastUpdatedAt,
} = await import("../lib/lt-directory-reads.js");

// Sample row fixtures matching the `lt_directory.$inferSelect` shape.
const HYPE_2L = "0xA000000000000000000000000000000000000001";
const DOGE_3L = "0xA000000000000000000000000000000000000003";

const sampleRow = (override: Partial<{
  address: string;
  targetAsset: string;
  targetLeverage: number;
  isLong: boolean;
  decimals: number;
  exchangeRate: string;
  mintPaused: boolean;
}> = {}) => ({
  address: HYPE_2L,
  symbol: "HYPE2L",
  name: "HYPE 2x Long",
  targetAsset: "HYPE",
  targetLeverage: 2,
  isLong: true,
  decimals: 18,
  exchangeRate: "1000000000000000000",
  mintPaused: false,
  baseAssetBalance: "0",
  totalAssets: "0",
  pollSequence: 1,
  lastSeenAt: new Date("2026-05-15T00:00:00Z"),
  createdAt: new Date("2026-05-15T00:00:00Z"),
  ...override,
});

describe("readLtDirectory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns directory rows mapped into LiveLeveragedToken shape", async () => {
    const rows = [sampleRow(), sampleRow({ address: DOGE_3L })];
    mockSelect.mockReturnValue(buildSelectChain(rows));

    const result = await readLtDirectory("postgres://test");
    expect(result).not.toBeNull();
    expect(result).toHaveLength(2);
    expect(result![0]).toMatchObject({
      address: HYPE_2L,
      symbol: "HYPE2L",
      targetAsset: "HYPE",
      targetLeverage: 2,
      isLong: true,
      exchangeRate: "1000000000000000000",
      mintPaused: false,
      totalSupply: "0",
    });
  });

  it("returns null on DB read failure", async () => {
    mockSelect.mockReturnValue(buildSelectChain(undefined, new Error("db down")));

    const result = await readLtDirectory("postgres://test");
    expect(result).toBeNull();
  });
});

describe("readSupportedLtDirectory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("filters to LTs that pass filterSupportedLTs", async () => {
    // Two rows: one supported (HYPE 2L), one unsupported (`FOO`).
    mockSelect.mockReturnValue(
      buildSelectChain([
        sampleRow(),
        sampleRow({ targetAsset: "FOO", targetLeverage: 7 }),
      ]),
    );

    const result = await readSupportedLtDirectory("postgres://test");
    expect(result).not.toBeNull();
    expect(result).toHaveLength(1);
    expect(result![0].targetAsset).toBe("HYPE");
  });

  it("returns null when the underlying read fails", async () => {
    mockSelect.mockReturnValue(buildSelectChain(undefined, new Error("boom")));
    const result = await readSupportedLtDirectory("postgres://test");
    expect(result).toBeNull();
  });
});

describe("readLiveLtRates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a Map keyed by lowercased address, value scaled by 1e18", async () => {
    mockSelect.mockReturnValue(
      buildSelectChain([
        { address: HYPE_2L, exchangeRate: "2500000000000000000" },
      ]),
    );

    const result = await readLiveLtRates("postgres://test");
    expect(result).not.toBeNull();
    expect(result!.get(HYPE_2L.toLowerCase())).toBeCloseTo(2.5, 12);
  });

  it("returns null on read failure", async () => {
    mockSelect.mockReturnValue(buildSelectChain(undefined, new Error("nope")));
    const result = await readLiveLtRates("postgres://test");
    expect(result).toBeNull();
  });
});

describe("readLtByAddress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null for an input that isn't a valid address", async () => {
    const result = await readLtByAddress("postgres://test", "not-an-address");
    expect(result).toBeNull();
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("looks up by checksummed address and returns the mapped LT", async () => {
    mockSelect.mockReturnValue(buildSelectChain([sampleRow()]));
    const result = await readLtByAddress(
      "postgres://test",
      HYPE_2L.toLowerCase(),
    );
    expect(result).toMatchObject({ address: HYPE_2L, symbol: "HYPE2L" });
  });

  it("returns null when address isn't in the directory", async () => {
    mockSelect.mockReturnValue(buildSelectChain([]));
    const result = await readLtByAddress("postgres://test", HYPE_2L);
    expect(result).toBeNull();
  });

  it("returns undefined on DB failure to distinguish from absent", async () => {
    mockSelect.mockReturnValue(buildSelectChain(undefined, new Error("rpc_error")));
    const result = await readLtByAddress("postgres://test", HYPE_2L);
    expect(result).toBeUndefined();
  });
});

describe("readDirectoryLastUpdatedAt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the max lastSeenAt timestamp", async () => {
    const when = new Date("2026-05-15T12:00:00Z");
    mockSelect.mockReturnValue(buildSelectChain([{ value: when }]));
    const result = await readDirectoryLastUpdatedAt("postgres://test");
    expect(result).toEqual(when);
  });

  it("returns null when the table is empty", async () => {
    mockSelect.mockReturnValue(buildSelectChain([{ value: null }]));
    const result = await readDirectoryLastUpdatedAt("postgres://test");
    expect(result).toBeNull();
  });

  it("returns null on DB failure", async () => {
    mockSelect.mockReturnValue(buildSelectChain(undefined, new Error("oops")));
    const result = await readDirectoryLastUpdatedAt("postgres://test");
    expect(result).toBeNull();
  });
});
