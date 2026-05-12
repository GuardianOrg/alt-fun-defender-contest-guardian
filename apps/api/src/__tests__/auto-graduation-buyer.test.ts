import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runAutoGraduationBuyer } from "../lib/auto-graduation-buyer.js";

import type { AppBindings } from "../lib/types.js";

// --- Viem boundary mock ---
//
// The keeper does three things at viem's surface:
//   - `getTransactionCount` (initial nonce read)
//   - `readContract` (USDC allowance pre-buy)
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

// --- Ponder boundary mock ---
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

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

/**
 * Shape of the JSON body the keeper POSTs to Ponder. Used by the
 * `mockFetch` callbacks below to route between the curve-token query
 * and the wallet-position query without inline type assertions.
 */
interface PonderRequestBody {
  query: string;
}

const baseEnv = {
  AUTO_GRADUATION_BUYER_PRIVATE_KEY: TEST_PRIVATE_KEY,
  PONDER_URL: "http://test-ponder",
  HYPEREVM_RPC_URL: "http://stub-rpc:1",
} as unknown as AppBindings;

function ponderResponse(data: unknown) {
  return {
    ok: true,
    json: () => Promise.resolve({ data }),
  };
}

beforeEach(() => {
  mockGetTransactionCount.mockReset();
  mockReadContract.mockReset();
  mockMulticall.mockReset();
  mockWriteContract.mockReset();
  mockFetch.mockReset();
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
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("proceeds when the finalize key resolves to a different wallet", async () => {
    // Symmetric counterpart to the same-wallet test: with the keys
    // resolving to two distinct addresses, the guard must NOT trip
    // and the keeper must move on to its normal Ponder + RPC reads.
    // This pins the guard's branch direction so a future refactor
    // can't accidentally invert it (e.g. by typo'ing `===` for `!==`)
    // without test feedback.
    const env = {
      ...baseEnv,
      AUTO_GRADUATION_BUYER_PRIVATE_KEY: TEST_PRIVATE_KEY,
      KEEPER_PRIVATE_KEY: OTHER_TEST_PRIVATE_KEY,
    } as unknown as AppBindings;

    mockGetTransactionCount.mockResolvedValue(0);
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: { tokens: { items: [] }, walletPositions: { items: [] } },
        }),
    });

    await runAutoGraduationBuyer(env);

    // Distinct wallets → guard passes → nonce read happens → no work
    // because Ponder returned empty for both phases.
    expect(mockGetTransactionCount).toHaveBeenCalledTimes(1);
  });

  it("aborts the buy phase when Ponder is unreachable but still runs the sell phase", async () => {
    mockGetTransactionCount.mockResolvedValue(7);
    mockFetch.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as PonderRequestBody;
      // Curve-token fetch fails; positions fetch succeeds with empty.
      if (body.query.includes("graduated: false, pendingGraduation: false")) {
        return { ok: false, json: () => Promise.resolve({}) };
      }
      return ponderResponse({ walletPositions: { items: [] } });
    });

    await runAutoGraduationBuyer(baseEnv);

    // Buy phase aborted before any RPC reads (Ponder returned null).
    expect(mockMulticall).not.toHaveBeenCalled();
    expect(mockReadContract).not.toHaveBeenCalled();
    expect(mockWriteContract).not.toHaveBeenCalled();

    // BUT — and this is the point of the test — a Ponder failure
    // on the buy-phase fetch must NOT short-circuit the sell phase.
    // The sell phase must still query Ponder for the bot's
    // outstanding positions so any token whose phase 2 just landed
    // gets unwound. Assert the sell-phase fetch fired by checking
    // mockFetch saw a body containing the `walletPositions` query.
    const sellFetchSeen = mockFetch.mock.calls.some((call) => {
      const init = call[1] as RequestInit;
      const body = JSON.parse(init.body as string) as PonderRequestBody;
      return body.query.includes("walletPositions");
    });
    expect(sellFetchSeen).toBe(true);
  });
});

describe("runAutoGraduationBuyer — buy phase", () => {
  it("submits one Zap.buy per `canGraduate=true` token, capped at MAX_BUYS_PER_TICK", async () => {
    // Six candidates — five expected to clear the per-tick cap, the
    // sixth held back for the next tick. Two of the six report
    // `canGraduate=false` (e.g. their LT just dropped between Ponder
    // freshness and the multicall) and must be filtered out.
    const candidates = Array.from(
      { length: 8 },
      (_, i) => `0x${(i + 1).toString(16).padStart(40, "0")}` as `0x${string}`,
    );

    mockGetTransactionCount.mockResolvedValue(100);
    mockFetch.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as PonderRequestBody;
      if (body.query.includes("graduated: false, pendingGraduation: false")) {
        return ponderResponse({
          tokens: { items: candidates.map((address) => ({ address })) },
        });
      }
      // Sell phase has nothing to do.
      return ponderResponse({ walletPositions: { items: [] } });
    });

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

    // USDC allowance is already at MAX — skip the approval branch
    // so the test asserts purely on the buy submissions.
    mockReadContract.mockResolvedValue(2n ** 256n - 1n);

    let writeCallCount = 0;
    mockWriteContract.mockImplementation(() =>
      Promise.resolve(`0x${"a".repeat(64)}${writeCallCount++}` as `0x${string}`),
    );

    await runAutoGraduationBuyer(baseEnv);

    // 5 buys (per-tick cap), 0 approvals (already maxed), 0 sells.
    expect(mockWriteContract).toHaveBeenCalledTimes(5);

    // Every write must be a `Zap.buy` and use sequential nonces
    // starting at the pending-nonce read.
    for (let i = 0; i < 5; i++) {
      const call = mockWriteContract.mock.calls[i]![0];
      expect(call.functionName).toBe("buy");
      expect(call.nonce).toBe(100 + i);
    }

    // Buys hit candidates[0..4], skipping nothing — the false-canGraduate
    // entries (indices 6, 7) are filtered before the cap kicks in.
    const buyTokens = mockWriteContract.mock.calls
      .slice(0, 5)
      .map((c) => c[0].args[0]);
    expect(buyTokens).toEqual(candidates.slice(0, 5));

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

  it("submits a USDC approval before buys when the existing allowance is too low", async () => {
    const candidate = "0x000000000000000000000000000000000000000a" as const;

    mockGetTransactionCount.mockResolvedValue(50);
    mockFetch.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as PonderRequestBody;
      if (body.query.includes("graduated: false, pendingGraduation: false")) {
        return ponderResponse({
          tokens: { items: [{ address: candidate }] },
        });
      }
      return ponderResponse({ walletPositions: { items: [] } });
    });
    mockMulticall
      .mockResolvedValueOnce([{ status: "success", result: true }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    // Allowance below the per-tick budget → approve must fire first.
    mockReadContract.mockResolvedValue(0n);

    let i = 0;
    mockWriteContract.mockImplementation(() =>
      Promise.resolve(`0x${"b".repeat(63)}${i++}` as `0x${string}`),
    );

    await runAutoGraduationBuyer(baseEnv);

    expect(mockWriteContract).toHaveBeenCalledTimes(2);
    expect(mockWriteContract.mock.calls[0]![0].functionName).toBe("approve");
    expect(mockWriteContract.mock.calls[0]![0].nonce).toBe(50);
    expect(mockWriteContract.mock.calls[1]![0].functionName).toBe("buy");
    // Buy nonce = approval nonce + 1.
    expect(mockWriteContract.mock.calls[1]![0].nonce).toBe(51);
  });

  it("reuses the same nonce for the next buy when a submission rejects pre-broadcast", async () => {
    // The keeper's nonce-management contract: a `writeContract` that
    // throws (typically a viem pre-flight `eth_call` revert — token
    // raced into `Graduating`, USDC balance exhausted, etc.) does
    // NOT consume the local nonce slot, because the tx never went
    // out on the wire. The next iteration of the buy loop must
    // therefore reuse that same nonce. Without this property a
    // single mid-batch failure would silently shift every subsequent
    // tx into a nonce-gap and they'd all stall in the mempool until
    // the gap fills (or never).
    const candidates = [
      "0x000000000000000000000000000000000000000a",
      "0x000000000000000000000000000000000000000b",
      "0x000000000000000000000000000000000000000c",
    ] as const;

    mockGetTransactionCount.mockResolvedValue(900);
    mockFetch.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as PonderRequestBody;
      if (body.query.includes("graduated: false, pendingGraduation: false")) {
        return ponderResponse({
          tokens: { items: candidates.map((address) => ({ address })) },
        });
      }
      return ponderResponse({ walletPositions: { items: [] } });
    });
    mockMulticall
      .mockResolvedValueOnce(
        candidates.map(() => ({ status: "success", result: true })),
      )
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    mockReadContract.mockResolvedValue(2n ** 256n - 1n); // skip approval

    // First buy rejects (simulating a `TokenIsGraduating` race);
    // remaining buys succeed.
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
    // 901 — i.e. the second buy reused the slot the rejected first
    // buy didn't consume. If the keeper had naively incremented
    // post-throw, the second buy would have used nonce 901 and the
    // third 902, leaving nonce 900 permanently unfilled.
    expect(mockWriteContract).toHaveBeenCalledTimes(3);
    expect(mockWriteContract.mock.calls[0]![0].nonce).toBe(900);
    expect(mockWriteContract.mock.calls[1]![0].nonce).toBe(900); // retry reuses
    expect(mockWriteContract.mock.calls[2]![0].nonce).toBe(901);
  });
});

describe("runAutoGraduationBuyer — sell phase", () => {
  it("skips positions whose lifecycle is `Graduating`", async () => {
    const heldToken = "0x000000000000000000000000000000000000beef" as const;

    mockGetTransactionCount.mockResolvedValue(200);
    mockFetch.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as PonderRequestBody;
      if (body.query.includes("graduated: false, pendingGraduation: false")) {
        return ponderResponse({ tokens: { items: [] } });
      }
      return ponderResponse({
        walletPositions: { items: [{ tokenAddress: heldToken }] },
      });
    });

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
    mockFetch.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as PonderRequestBody;
      if (body.query.includes("graduated: false, pendingGraduation: false")) {
        return ponderResponse({ tokens: { items: [] } });
      }
      return ponderResponse({
        walletPositions: { items: [{ tokenAddress: heldToken }] },
      });
    });
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
    // Sells the full on-chain balance (NOT what Ponder reported — the
    // multicall `balanceOf` is the source of truth for the amount).
    expect(call.args[1]).toBe(12345n);
    // `minUsdcOut = 0` — the bot is unwinding a triggering position,
    // not optimising for price. Slippage doesn't matter.
    expect(call.args[2]).toBe(0n);
    expect(call.nonce).toBe(300);
  });

  it("inserts a one-time Token.approve before the first sell when allowance is insufficient", async () => {
    const heldToken = "0x000000000000000000000000000000000000abcd" as const;

    mockGetTransactionCount.mockResolvedValue(400);
    mockFetch.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as PonderRequestBody;
      if (body.query.includes("graduated: false, pendingGraduation: false")) {
        return ponderResponse({ tokens: { items: [] } });
      }
      return ponderResponse({
        walletPositions: { items: [{ tokenAddress: heldToken }] },
      });
    });
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

  it("skips positions with a zero on-chain balance even if Ponder reports them", async () => {
    const heldToken = "0x000000000000000000000000000000000000dead" as const;

    mockGetTransactionCount.mockResolvedValue(500);
    mockFetch.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as PonderRequestBody;
      if (body.query.includes("graduated: false, pendingGraduation: false")) {
        return ponderResponse({ tokens: { items: [] } });
      }
      return ponderResponse({
        walletPositions: { items: [{ tokenAddress: heldToken }] },
      });
    });
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
    mockFetch.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as PonderRequestBody;
      if (body.query.includes("graduated: false, pendingGraduation: false")) {
        return ponderResponse({ tokens: { items: [] } });
      }
      return ponderResponse({
        walletPositions: {
          items: positions.map((tokenAddress) => ({ tokenAddress })),
        },
      });
    });
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

    // The first 5 positions hit (in Ponder's returned order — no
    // ordering knob in the sell-phase Ponder query, so it's
    // whatever the indexer provides). Confirms the cap takes
    // effect by truncation, not by random sampling.
    const sellTokens = mockWriteContract.mock.calls
      .slice(0, 5)
      .map((c) => c[0].args[0]);
    expect(sellTokens).toEqual(positions.slice(0, 5));
  });
});
