import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Viem boundary mock ---
//
// The keeper does three things at viem's surface:
//   - `getTransactionCount` (initial nonce read)
//   - `readContract` (legacy: held in case we need it again)
//   - `multicall` (canGraduate / balanceOf+allowance / isGraduating)
//   - `writeContract` (every submitted tx)
// Mocking at the viem boundary keeps the keeper's branching logic
// exercised end-to-end without depending on JSON-RPC wire formats,
// which can drift across viem minor versions.
const mockGetTransactionCount = vi.fn();
const mockReadContract = vi.fn();
const mockMulticall = vi.fn();
const mockWriteContract = vi.fn();

vi.mock("viem", async () => {
  const actual = await vi.importActual<typeof import("viem")>("viem");
  return {
    ...actual,
    createPublicClient: () => ({
      getTransactionCount: mockGetTransactionCount,
      readContract: mockReadContract,
      multicall: mockMulticall,
    }),
    createWalletClient: () => ({
      writeContract: mockWriteContract,
    }),
  };
});

// --- Indexer-reads boundary mock ---
//
// The keeper now talks to Postgres via two helpers in
// `lib/indexer-reads.ts` (replacing the legacy Ponder GraphQL hop in
// PR #1073). Mock the helpers directly so each test stages exactly the
// row shapes the keeper sees, and the DB client stays untouched —
// matches the same boundary the keeper relies on in production.
const mockFetchCurvePhaseTokens = vi.fn();
const mockFetchNonZeroWalletZapPositions = vi.fn();

vi.mock("../lib/indexer-reads.js", () => ({
  fetchCurvePhaseTokens: mockFetchCurvePhaseTokens,
  fetchNonZeroWalletZapPositions: mockFetchNonZeroWalletZapPositions,
}));

// `createDb` is the constructor the keeper calls to obtain its Drizzle
// handle; stub it to a sentinel so the helpers above receive *some* db
// argument without spinning up a real connection. The mocks above
// ignore the argument entirely.
vi.mock("../db/client.js", () => ({
  createDb: () => ({ __db: true }),
}));

const { runAutoGraduationBuyer } = await import(
  "../lib/auto-graduation-buyer.js"
);

import type { AppBindings } from "../lib/types.js";

/**
 * Derive a deterministic 32-byte private key from a small integer seed.
 * `viem/accounts.privateKeyToAccount` accepts any 32-byte value above
 * zero and below the secp256k1 group order as a valid key, so single-
 * digit seeds map cleanly to leading-zero-padded hex.
 *
 * Generated at runtime instead of committing literal key material, even
 * though these test wallets never hold real funds — keeps SAST scanners
 * (gitleaks etc.) and human reviewers from flagging the file as
 * containing committed secrets, and removes the "is this a real key?"
 * cognitive load on anyone touching the test in future.
 */
function makeDeterministicTestPrivateKey(seed: number): `0x${string}` {
  return `0x${seed.toString(16).padStart(64, "0")}` as `0x${string}`;
}

// The two keys must derive to DIFFERENT addresses for the same-wallet
// guard test to be meaningful — distinct seeds satisfy that
// trivially (each maps to a unique private key, and viem's address
// derivation is collision-resistant).
const TEST_PRIVATE_KEY = makeDeterministicTestPrivateKey(1);
const OTHER_TEST_PRIVATE_KEY = makeDeterministicTestPrivateKey(2);

const baseEnv = {
  AUTO_GRADUATION_BUYER_PRIVATE_KEY: TEST_PRIVATE_KEY,
  DATABASE_URL: "postgres://test",
  HYPEREVM_RPC_URL: "http://stub-rpc:1",
} as unknown as AppBindings;

beforeEach(() => {
  mockGetTransactionCount.mockReset();
  mockReadContract.mockReset();
  mockMulticall.mockReset();
  mockWriteContract.mockReset();
  mockFetchCurvePhaseTokens.mockReset();
  mockFetchNonZeroWalletZapPositions.mockReset();
  // Default both phases to an empty result so a test that only stages
  // one of them doesn't accidentally hit `undefined.length`.
  mockFetchCurvePhaseTokens.mockResolvedValue([]);
  mockFetchNonZeroWalletZapPositions.mockResolvedValue([]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("runAutoGraduationBuyer — gating", () => {
  it("returns early without touching the chain when the key is unset", async () => {
    const env = {
      ...baseEnv,
      AUTO_GRADUATION_BUYER_PRIVATE_KEY: undefined,
    } as unknown as AppBindings;

    await runAutoGraduationBuyer(env);

    // No private key → no wallet derivation, no nonce fetch, no
    // multicall, no writes. Crucially: cron must not flap to ON the
    // moment a key is deployed in dev — the disabled branch should
    // be a pure no-op (modulo the warn log this asserts via
    // absence of mock interactions).
    expect(mockGetTransactionCount).not.toHaveBeenCalled();
    expect(mockMulticall).not.toHaveBeenCalled();
    expect(mockWriteContract).not.toHaveBeenCalled();
    expect(mockFetchCurvePhaseTokens).not.toHaveBeenCalled();
  });

  it("aborts immediately when the auto-buy and finalize keys derive to the same wallet", async () => {
    // Sticky-per-wallet block-size invariant: the finalize keeper sits
    // on big blocks, the auto-buyer on small. Sharing one wallet is a
    // misconfiguration that would silently queue one keeper's txs
    // behind the other's confirms — refuse to operate instead of
    // letting it manifest as user-visible graduation latency. The
    // guard runs BEFORE any RPC interaction so we don't even derive
    // a public client when it trips.
    const env = {
      ...baseEnv,
      AUTO_GRADUATION_BUYER_PRIVATE_KEY: TEST_PRIVATE_KEY,
      KEEPER_PRIVATE_KEY: TEST_PRIVATE_KEY,
    } as unknown as AppBindings;

    await runAutoGraduationBuyer(env);

    expect(mockGetTransactionCount).not.toHaveBeenCalled();
    expect(mockMulticall).not.toHaveBeenCalled();
    expect(mockWriteContract).not.toHaveBeenCalled();
    expect(mockFetchCurvePhaseTokens).not.toHaveBeenCalled();
  });

  it("proceeds when the finalize key resolves to a different wallet", async () => {
    // Symmetric counterpart to the same-wallet test: with the keys
    // resolving to two distinct addresses, the guard must NOT trip
    // and the keeper must move on to its normal indexer + RPC reads.
    // This pins the guard's branch direction so a future refactor
    // can't accidentally invert it (e.g. by typo'ing `===` for `!==`)
    // without test feedback.
    const env = {
      ...baseEnv,
      AUTO_GRADUATION_BUYER_PRIVATE_KEY: TEST_PRIVATE_KEY,
      KEEPER_PRIVATE_KEY: OTHER_TEST_PRIVATE_KEY,
    } as unknown as AppBindings;

    mockGetTransactionCount.mockResolvedValue(0);

    await runAutoGraduationBuyer(env);

    // Distinct wallets → guard passes → nonce read happens → no work
    // because both helpers returned empty.
    expect(mockGetTransactionCount).toHaveBeenCalledTimes(1);
    expect(mockFetchCurvePhaseTokens).toHaveBeenCalledTimes(1);
    expect(mockFetchNonZeroWalletZapPositions).toHaveBeenCalledTimes(1);
  });

  it("aborts the trigger phase when the indexer is unreachable but still runs the sell phase", async () => {
    mockGetTransactionCount.mockResolvedValue(7);
    // Trigger phase: helper returns `null` to signal a DB read failure
    // (matches the legacy GraphQL-null behaviour). Sell phase still
    // succeeds with an empty position set.
    mockFetchCurvePhaseTokens.mockResolvedValue(null);
    mockFetchNonZeroWalletZapPositions.mockResolvedValue([]);

    await runAutoGraduationBuyer(baseEnv);

    // Trigger phase aborted before any RPC reads (helper returned null).
    expect(mockMulticall).not.toHaveBeenCalled();
    expect(mockReadContract).not.toHaveBeenCalled();
    expect(mockWriteContract).not.toHaveBeenCalled();

    // BUT — and this is the point of the test — a trigger-phase
    // indexer failure must NOT short-circuit the sell phase. The sell
    // phase must still query the indexer for any legacy positions
    // accumulated by the previous `Zap.buy`-trigger flow so they get
    // unwound.
    expect(mockFetchNonZeroWalletZapPositions).toHaveBeenCalledTimes(1);
  });
});

describe("runAutoGraduationBuyer — trigger phase", () => {
  it("submits one Bonding.triggerGraduation per `canGraduate=true` token, capped at MAX_TRIGGERS_PER_TICK", async () => {
    // Eight candidates — five expected to clear the per-tick cap, the
    // sixth held back for the next tick. Two of the eight report
    // `canGraduate=false` (e.g. their LT just dropped between the
    // indexer read and the multicall) and must be filtered out.
    const candidates = Array.from(
      { length: 8 },
      (_, i) => `0x${(i + 1).toString(16).padStart(40, "0")}` as `0x${string}`,
    );

    mockGetTransactionCount.mockResolvedValue(100);
    mockFetchCurvePhaseTokens.mockResolvedValue(
      candidates.map((address) => ({ address })),
    );

    // Multicall responses (in order):
    //   1) `canGraduate` — first 6 are `true`, last 2 are `false`.
    //   2) Sell-phase ERC20 batch (empty).
    //   3) Sell-phase isGraduating batch (empty).
    mockMulticall
      .mockResolvedValueOnce(
        candidates.map((_, i) => ({
          status: "success",
          result: i < 6,
        })),
      )
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    let writeCallCount = 0;
    mockWriteContract.mockImplementation(() =>
      Promise.resolve(`0x${"a".repeat(64)}${writeCallCount++}` as `0x${string}`),
    );

    await runAutoGraduationBuyer(baseEnv);

    // 5 triggers (per-tick cap), 0 sells. No USDC approval — the
    // permissionless `triggerGraduation` entry point doesn't move
    // any tokens, so the keeper has nothing to pre-approve.
    expect(mockWriteContract).toHaveBeenCalledTimes(5);

    // Every write must be a `Bonding.triggerGraduation` and use
    // sequential nonces starting at the pending-nonce read.
    for (let i = 0; i < 5; i++) {
      const call = mockWriteContract.mock.calls[i]![0];
      expect(call.functionName).toBe("triggerGraduation");
      expect(call.nonce).toBe(100 + i);
    }

    // Triggers hit candidates[0..4] — the false-canGraduate entries
    // (indices 6, 7) are filtered before the cap kicks in.
    const triggerTokens = mockWriteContract.mock.calls
      .slice(0, 5)
      .map((c) => c[0].args[0]);
    expect(triggerTokens).toEqual(candidates.slice(0, 5));

    // Regression guard: writeContract calls MUST NOT pass an `account`
    // override. Passing an Address string (e.g. `account: bot`) here
    // would force viem onto JSON-RPC's `eth_sendTransaction`, which
    // Alchemy and other public RPCs reject (no unlocked accounts) —
    // the bound `LocalAccount` from `privateKeyToAccount(pk)` is what
    // enables local signing + `eth_sendRawTransaction`. Pinning this
    // explicitly because it's exactly the kind of subtle "still
    // passes a happy-path test, breaks at the broadcast step in
    // prod" bug.
    for (const c of mockWriteContract.mock.calls) {
      expect(c[0]).not.toHaveProperty("account");
    }
  });

  it("does not pre-approve USDC — `triggerGraduation` doesn't move any tokens", async () => {
    // Regression guard against the legacy `Zap.buy`-trigger flow,
    // which prepended a `MAX_UINT256` USDC approve. The new flow
    // doesn't custody USDC at all, so any approve here would be a
    // wasted gas + nonce burn (and a misleading on-chain footprint
    // for anyone tracing the keeper wallet).
    const candidate = "0x000000000000000000000000000000000000000a" as const;

    mockGetTransactionCount.mockResolvedValue(50);
    mockFetchCurvePhaseTokens.mockResolvedValue([{ address: candidate }]);
    mockMulticall
      .mockResolvedValueOnce([{ status: "success", result: true }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    let i = 0;
    mockWriteContract.mockImplementation(() =>
      Promise.resolve(`0x${"b".repeat(63)}${i++}` as `0x${string}`),
    );

    await runAutoGraduationBuyer(baseEnv);

    // Single tx — the trigger itself. No allowance read, no
    // approval write.
    expect(mockReadContract).not.toHaveBeenCalled();
    expect(mockWriteContract).toHaveBeenCalledTimes(1);
    expect(mockWriteContract.mock.calls[0]![0].functionName).toBe(
      "triggerGraduation",
    );
    expect(mockWriteContract.mock.calls[0]![0].nonce).toBe(50);
  });

  it("reuses the same nonce for the next trigger when a submission rejects pre-broadcast", async () => {
    // The keeper's nonce-management contract: a `writeContract` that
    // throws (typically a viem pre-flight `eth_call` revert — token
    // raced into `Graduating`, LT rate dropped so `canGraduate`
    // flipped to false, etc.) does NOT consume the local nonce slot,
    // because the tx never went out on the wire. The next iteration
    // of the trigger loop must therefore reuse that same nonce.
    // Without this property a single mid-batch failure would
    // silently shift every subsequent tx into a nonce-gap and they'd
    // all stall in the mempool until the gap fills (or never).
    const candidates = [
      "0x000000000000000000000000000000000000000a",
      "0x000000000000000000000000000000000000000b",
      "0x000000000000000000000000000000000000000c",
    ] as const;

    mockGetTransactionCount.mockResolvedValue(900);
    mockFetchCurvePhaseTokens.mockResolvedValue(
      candidates.map((address) => ({ address })),
    );
    mockMulticall
      .mockResolvedValueOnce(
        candidates.map(() => ({ status: "success", result: true })),
      )
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    // First trigger rejects (simulating a `TokenIsGraduating` race);
    // remaining triggers succeed.
    let i = 0;
    mockWriteContract.mockImplementation(() => {
      const callIdx = i++;
      if (callIdx === 0) {
        return Promise.reject(new Error("pre-flight revert: TokenIsGraduating"));
      }
      return Promise.resolve(`0x${"e".repeat(63)}${callIdx}` as `0x${string}`);
    });

    await runAutoGraduationBuyer(baseEnv);

    // Three writeContract calls fired (one rejected + two
    // succeeded). The two successful ones must use nonces 900 and
    // 901 — i.e. the second trigger reused the slot the rejected
    // first trigger didn't consume. If the keeper had naively
    // incremented post-throw, the second trigger would have used
    // nonce 901 and the third 902, leaving nonce 900 permanently
    // unfilled.
    expect(mockWriteContract).toHaveBeenCalledTimes(3);
    expect(mockWriteContract.mock.calls[0]![0].nonce).toBe(900);
    expect(mockWriteContract.mock.calls[1]![0].nonce).toBe(900); // retry reuses
    expect(mockWriteContract.mock.calls[2]![0].nonce).toBe(901);
  });

  it("passes the bot's checksummed wallet straight through to the position helper (lower-casing happens inside)", async () => {
    // Regression guard for the PR #1073 migration: the legacy GraphQL
    // path explicitly called `.toLowerCase()` at the boundary because
    // Ponder stores wallets lowercased. The new helper does the same
    // internally, so the keeper just forwards `account.address`
    // verbatim. Pin the contract here so a future refactor that drops
    // the helper's internal lower-case doesn't silently start returning
    // zero positions for every checksum-cased wallet.
    mockGetTransactionCount.mockResolvedValue(0);
    mockFetchCurvePhaseTokens.mockResolvedValue([]);
    mockFetchNonZeroWalletZapPositions.mockResolvedValue([]);

    await runAutoGraduationBuyer(baseEnv);

    expect(mockFetchNonZeroWalletZapPositions).toHaveBeenCalledTimes(1);
    const args = mockFetchNonZeroWalletZapPositions.mock.calls[0]!;
    // args[0] is the db sentinel, args[1] is the wallet, args[2] is the
    // POSITION_FETCH_LIMIT pre-filter cap.
    const wallet = args[1] as string;
    expect(wallet).toMatch(/^0x[0-9a-fA-F]{40}$/);
    // Helper lower-cases internally — but the keeper passes the
    // viem-derived checksum, which contains at least one upper-case
    // hex char for any non-pathological key. (Seed=1 maps to a
    // mixed-case address.)
    expect(wallet).not.toBe(wallet.toLowerCase());
  });
});

describe("runAutoGraduationBuyer — sell phase", () => {
  it("skips positions whose lifecycle is `Graduating`", async () => {
    const heldToken = "0x000000000000000000000000000000000000beef" as const;

    mockGetTransactionCount.mockResolvedValue(200);
    mockFetchNonZeroWalletZapPositions.mockResolvedValue([
      { tokenAddress: heldToken },
    ]);

    // Multicall order: ERC20 batch (balance, allowance), then
    // isGraduating batch.
    mockMulticall
      .mockResolvedValueOnce([
        { status: "success", result: 100n }, // balance > 0
        { status: "success", result: 2n ** 256n - 1n }, // allowance pre-set
      ])
      .mockResolvedValueOnce([
        { status: "success", result: true }, // currently in Graduating window
      ]);

    await runAutoGraduationBuyer(baseEnv);

    // Token is mid-graduation — `Zap.sell` would revert with
    // `TokenIsGraduating`. Keeper must hold off until phase 2 lands.
    expect(mockWriteContract).not.toHaveBeenCalled();
  });

  it("submits Zap.sell for a non-graduating position with a non-zero balance", async () => {
    const heldToken = "0x000000000000000000000000000000000000c0de" as const;

    mockGetTransactionCount.mockResolvedValue(300);
    mockFetchNonZeroWalletZapPositions.mockResolvedValue([
      { tokenAddress: heldToken },
    ]);
    mockMulticall
      .mockResolvedValueOnce([
        { status: "success", result: 12345n }, // current balance
        { status: "success", result: 2n ** 256n - 1n }, // already approved
      ])
      .mockResolvedValueOnce([
        { status: "success", result: false }, // not in Graduating
      ]);

    let i = 0;
    mockWriteContract.mockImplementation(() =>
      Promise.resolve(`0x${"c".repeat(63)}${i++}` as `0x${string}`),
    );

    await runAutoGraduationBuyer(baseEnv);

    expect(mockWriteContract).toHaveBeenCalledTimes(1);
    const call = mockWriteContract.mock.calls[0]![0];
    expect(call.functionName).toBe("sell");
    expect(call.args[0]).toBe(heldToken);
    // Sells the full on-chain balance (NOT what the indexer reported —
    // the multicall `balanceOf` is the source of truth for the amount).
    expect(call.args[1]).toBe(12345n);
    // `minUsdcOut = 0` — the bot is unwinding a triggering position,
    // not optimising for price. Slippage doesn't matter.
    expect(call.args[2]).toBe(0n);
    expect(call.nonce).toBe(300);
  });

  it("inserts a one-time Token.approve before the first sell when allowance is insufficient", async () => {
    const heldToken = "0x000000000000000000000000000000000000abcd" as const;

    mockGetTransactionCount.mockResolvedValue(400);
    mockFetchNonZeroWalletZapPositions.mockResolvedValue([
      { tokenAddress: heldToken },
    ]);
    mockMulticall
      .mockResolvedValueOnce([
        { status: "success", result: 999n }, // balance
        { status: "success", result: 0n }, // no prior allowance
      ])
      .mockResolvedValueOnce([{ status: "success", result: false }]);

    let i = 0;
    mockWriteContract.mockImplementation(() =>
      Promise.resolve(`0x${"d".repeat(63)}${i++}` as `0x${string}`),
    );

    await runAutoGraduationBuyer(baseEnv);

    expect(mockWriteContract).toHaveBeenCalledTimes(2);
    expect(mockWriteContract.mock.calls[0]![0].functionName).toBe("approve");
    expect(mockWriteContract.mock.calls[0]![0].address).toBe(heldToken);
    expect(mockWriteContract.mock.calls[0]![0].nonce).toBe(400);
    expect(mockWriteContract.mock.calls[1]![0].functionName).toBe("sell");
    expect(mockWriteContract.mock.calls[1]![0].nonce).toBe(401);
  });

  it("skips positions with a zero on-chain balance even if the indexer reports them", async () => {
    const heldToken = "0x000000000000000000000000000000000000dead" as const;

    mockGetTransactionCount.mockResolvedValue(500);
    mockFetchNonZeroWalletZapPositions.mockResolvedValue([
      { tokenAddress: heldToken },
    ]);
    mockMulticall
      .mockResolvedValueOnce([
        { status: "success", result: 0n }, // zero balance
        { status: "success", result: 2n ** 256n - 1n },
      ])
      .mockResolvedValueOnce([{ status: "success", result: false }]);

    await runAutoGraduationBuyer(baseEnv);

    // Indexer lag can leave a stale position row pointing at a token
    // we already sold or never received. Don't burn nonces / gas on
    // an empty sell — `Zap.sell(0)` reverts on `InvalidInput` anyway.
    expect(mockWriteContract).not.toHaveBeenCalled();
  });

  it("caps sell submissions at MAX_SELLS_PER_TICK regardless of how many positions are eligible", async () => {
    // Mirror of the buy-side per-tick-cap test. Wallets that
    // accumulated a backlog (e.g. the keeper recovered from an
    // outage and has 8 positions waiting to unwind) drain the
    // backlog over multiple ticks instead of trying to fire all
    // sells in one cron window — sells are 2 txs each (allowance
    // pre-set in this scenario, so 1 tx each), so the per-tick
    // capital exposure stays bounded.
    const positions = Array.from(
      { length: 8 },
      (_, i) => `0x${(i + 1).toString(16).padStart(40, "0")}` as `0x${string}`,
    );

    mockGetTransactionCount.mockResolvedValue(700);
    mockFetchNonZeroWalletZapPositions.mockResolvedValue(
      positions.map((tokenAddress) => ({ tokenAddress })),
    );
    // Each position: non-zero balance, allowance already maxed
    // (skip approve), not graduating.
    mockMulticall
      .mockResolvedValueOnce(
        positions.flatMap(() => [
          { status: "success", result: 1_000n },
          { status: "success", result: 2n ** 256n - 1n },
        ]),
      )
      .mockResolvedValueOnce(
        positions.map(() => ({ status: "success", result: false })),
      );

    let i = 0;
    mockWriteContract.mockImplementation(() =>
      Promise.resolve(`0x${"f".repeat(63)}${i++}` as `0x${string}`),
    );

    await runAutoGraduationBuyer(baseEnv);

    // Cap is 5 (MAX_SELLS_PER_TICK). The 6th-8th positions wait
    // for the next tick.
    expect(mockWriteContract).toHaveBeenCalledTimes(5);
    for (let j = 0; j < 5; j++) {
      const call = mockWriteContract.mock.calls[j]![0];
      expect(call.functionName).toBe("sell");
      expect(call.nonce).toBe(700 + j);
    }

    // The first 5 positions hit (in the indexer's returned order —
    // `fetchNonZeroWalletZapPositions` sorts by `token_address asc`,
    // which the helper docstring pins). Confirms the cap takes
    // effect by truncation, not by random sampling.
    const sellTokens = mockWriteContract.mock.calls
      .slice(0, 5)
      .map((c) => c[0].args[0]);
    expect(sellTokens).toEqual(positions.slice(0, 5));
  });
});
