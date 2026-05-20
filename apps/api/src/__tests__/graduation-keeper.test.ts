import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mocked at the viem boundary for the same reason as
// `auto-graduation-buyer.test.ts`: keep the keeper's branching exercised
// without depending on the JSON-RPC wire shape, which can drift across
// viem minor versions.
const mockGetTransactionCount = vi.fn();
const mockWriteContract = vi.fn();

vi.mock("viem", async () => {
  const actual = await vi.importActual<typeof import("viem")>("viem");
  return {
    ...actual,
    createPublicClient: () => ({
      getTransactionCount: mockGetTransactionCount,
    }),
    createWalletClient: () => ({
      writeContract: mockWriteContract,
    }),
  };
});

// Indexer-reads boundary mock — the keeper now reads pending tokens via
// `fetchPendingGraduationTokens(db)` instead of a Ponder GraphQL query
// (PR #1073). Stub the helper directly so each test stages exactly the
// row shape the keeper sees.
const mockFetchPendingGraduationTokens = vi.fn();
vi.mock("../lib/indexer-reads.js", () => ({
  fetchPendingGraduationTokens: mockFetchPendingGraduationTokens,
}));

// DB-client constructor stubbed to a sentinel — the helper above ignores
// its argument entirely.
vi.mock("../db/client.js", () => ({
  createDb: () => ({ __db: true }),
}));

const { runGraduationKeeper } = await import("../lib/graduation-keeper.js");

import type { AppBindings } from "../lib/types.js";

function makeKey(seed: number): `0x${string}` {
  return `0x${seed.toString(16).padStart(64, "0")}` as `0x${string}`;
}

const KEEPER_PRIVATE_KEY = makeKey(3);

const baseEnv = {
  KEEPER_PRIVATE_KEY,
  HYPERDRIVE: { connectionString: "postgres://hyperdrive-test" } as unknown as Hyperdrive,
  DATABASE_URL: "postgres://test",
  HYPEREVM_RPC_URL: "http://stub-rpc:1",
} as unknown as AppBindings;

beforeEach(() => {
  mockGetTransactionCount.mockReset();
  mockWriteContract.mockReset();
  mockFetchPendingGraduationTokens.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("runGraduationKeeper", () => {
  it("returns early without touching the chain when the key is unset", async () => {
    const env = {
      ...baseEnv,
      KEEPER_PRIVATE_KEY: undefined,
    } as unknown as AppBindings;

    await runGraduationKeeper(env);

    // Disabled branch must be a pure no-op — no DB read, no nonce
    // fetch, no writes. Mirrors the same guarantee the auto-buyer
    // keeper makes when its key is unset.
    expect(mockFetchPendingGraduationTokens).not.toHaveBeenCalled();
    expect(mockGetTransactionCount).not.toHaveBeenCalled();
    expect(mockWriteContract).not.toHaveBeenCalled();
  });

  it("skips the tick when the indexer DB read fails", async () => {
    // Helper returns `null` to signal a DB error (see indexer-reads.ts
    // docstring). The keeper must skip rather than retry with stale
    // data — matches the prior GraphQL-null behaviour.
    mockFetchPendingGraduationTokens.mockResolvedValue(null);

    await runGraduationKeeper(baseEnv);

    expect(mockGetTransactionCount).not.toHaveBeenCalled();
    expect(mockWriteContract).not.toHaveBeenCalled();
  });

  it("does nothing when no pending tokens exist", async () => {
    mockFetchPendingGraduationTokens.mockResolvedValue([]);

    await runGraduationKeeper(baseEnv);

    // The keeper never reaches the nonce fetch / write loop when the
    // pending set is empty. Skipping the RPC keeps the cron tick free
    // to do other work (LT ticker, registration backfill, etc.).
    expect(mockGetTransactionCount).not.toHaveBeenCalled();
    expect(mockWriteContract).not.toHaveBeenCalled();
  });

  it("submits one finalizeGraduation per pending token, capped at MAX_FINALIZES_PER_TICK", async () => {
    // Eight pending tokens — the per-tick cap is 5, so the last three
    // wait for the next tick. Helper returns them already sorted by
    // `pendingGraduationAt asc` (FIFO fairness), so the order the keeper
    // submits should match.
    const pending = Array.from({ length: 8 }, (_, i) => ({
      address: `0x${(i + 1).toString(16).padStart(40, "0")}`,
      pendingGraduationAt: String(1_700_000_000 + i),
    }));
    mockFetchPendingGraduationTokens.mockResolvedValue(pending);
    mockGetTransactionCount.mockResolvedValue(42);

    let i = 0;
    mockWriteContract.mockImplementation(() =>
      Promise.resolve(`0x${"a".repeat(63)}${i++}` as `0x${string}`),
    );

    await runGraduationKeeper(baseEnv);

    expect(mockWriteContract).toHaveBeenCalledTimes(5);
    for (let j = 0; j < 5; j++) {
      const call = mockWriteContract.mock.calls[j]![0];
      expect(call.functionName).toBe("finalizeGraduation");
      expect(call.nonce).toBe(42 + j);
      expect(call.args[0]).toBe(pending[j]!.address);
    }
  });

  it("reuses the same nonce when a submission rejects pre-broadcast", async () => {
    // Mirror of the auto-buyer's nonce-reuse contract: a failed
    // `writeContract` (pre-flight `eth_call` revert) doesn't consume
    // the local nonce slot because the tx never went out. Without
    // this property a single mid-batch failure shifts every subsequent
    // tx into a nonce-gap and they all stall in the mempool.
    const pending = Array.from({ length: 3 }, (_, i) => ({
      address: `0x${(i + 1).toString(16).padStart(40, "0")}`,
      pendingGraduationAt: String(1_700_000_000 + i),
    }));
    mockFetchPendingGraduationTokens.mockResolvedValue(pending);
    mockGetTransactionCount.mockResolvedValue(100);

    let callIdx = 0;
    mockWriteContract.mockImplementation(() => {
      const idx = callIdx++;
      if (idx === 0) {
        return Promise.reject(new Error("pre-flight revert: NotGraduating"));
      }
      return Promise.resolve(`0x${"b".repeat(63)}${idx}` as `0x${string}`);
    });

    await runGraduationKeeper(baseEnv);

    expect(mockWriteContract).toHaveBeenCalledTimes(3);
    expect(mockWriteContract.mock.calls[0]![0].nonce).toBe(100);
    expect(mockWriteContract.mock.calls[1]![0].nonce).toBe(100); // retry reuses
    expect(mockWriteContract.mock.calls[2]![0].nonce).toBe(101);
  });
});
