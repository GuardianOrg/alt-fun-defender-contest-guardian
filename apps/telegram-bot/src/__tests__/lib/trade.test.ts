import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  WaitForTransactionReceiptTimeoutError,
  domainSeparator,
  encodeAbiParameters,
  encodeErrorResult,
  encodeEventTopics,
  parseAbi,
  recoverTypedDataAddress,
} from "viem";
import { BotFeeRouterAbi } from "@launchpad/shared";
import { privateKeyToAccount } from "viem/accounts";

import {
  awaitReceipt,
  buildPublicClient,
  computeMinTokensOut,
  computeMinUsdcOut,
  executeBuy,
  explorerTxUrl,
  renderExecutionError,
  signPermitForRouter,
  simulateBuyWithBotFee,
  simulateSellWithBotFee,
  tryPermit,
  usdcRawToNumber,
} from "../../lib/trade.js";
import {
  INTENT_TTL_SECONDS,
  intentKey,
  markFinal,
  markSubmitted,
  type IdempotencyKv,
} from "../../lib/idempotency.js";
import { HYPER_EVM, USDC_ADDRESS } from "@launchpad/shared";

const RPC_URL = "https://rpc.test.local";
const ROUTER = "0x4444444444444444444444444444444444444444";
const TOKEN = "0x1111111111111111111111111111111111111111";
const TRADER = "0x2222222222222222222222222222222222222222";

/** ABI-encode a single uint256 result for `eth_call` responses. */
const encodeUint256 = (v: bigint): string =>
  encodeAbiParameters([{ type: "uint256" }], [v]);

/** Encode `Error(string)` revert data — viem's `eth_call` returns this for
 *  string-revert reverts and `simulateContract` walks it into a typed error. */
const encodeStringRevert = (message: string): string =>
  encodeErrorResult({
    abi: parseAbi(["error Error(string)"]),
    errorName: "Error",
    args: [message],
  });

const rpcOk = (result: string): Response =>
  new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), {
    status: 200,
  });

const rpcRevert = (data: string): Response =>
  new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      error: {
        code: 3,
        message: "execution reverted",
        // viem decodes `data` as the revert blob.
        data,
      },
    }),
    { status: 200 },
  );

describe("simulateSellWithBotFee", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("returns `not_configured` when BOT_FEE_ROUTER_ADDRESS is unset", async () => {
    const result = await simulateSellWithBotFee(
      { HYPEREVM_RPC_URL: RPC_URL },
      {
        token: `${TOKEN}` as `0x${string}`,
        tokenAmount: 1n,
        trader: `${TRADER}` as `0x${string}`,
      },
    );
    expect(result).toEqual({ ok: false, kind: "not_configured" });
    // Must not have made any RPC call when the router is unconfigured.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns `not_configured` when the env var is whitespace-only", async () => {
    const result = await simulateSellWithBotFee(
      {
        HYPEREVM_RPC_URL: RPC_URL,
        BOT_FEE_ROUTER_ADDRESS: "   ",
      },
      {
        token: `${TOKEN}` as `0x${string}`,
        tokenAmount: 1n,
        trader: `${TRADER}` as `0x${string}`,
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("not_configured");
  });

  it("decodes a successful simulation into quotedUsdcOut", async () => {
    // 50 USDC = 50_000_000 raw (6dp).
    fetchSpy.mockResolvedValue(rpcOk(encodeUint256(50_000_000n)));

    const result = await simulateSellWithBotFee(
      {
        HYPEREVM_RPC_URL: RPC_URL,
        BOT_FEE_ROUTER_ADDRESS: ROUTER,
      },
      {
        token: `${TOKEN}` as `0x${string}`,
        tokenAmount: 100_000n * 10n ** 18n,
        trader: `${TRADER}` as `0x${string}`,
      },
    );
    expect(result).toEqual({ ok: true, quotedUsdcOut: 50_000_000n });
  });

  it("targets the BOT_FEE_ROUTER_ADDRESS, not Zap, in the eth_call", async () => {
    fetchSpy.mockResolvedValue(rpcOk(encodeUint256(1n)));

    await simulateSellWithBotFee(
      {
        HYPEREVM_RPC_URL: RPC_URL,
        BOT_FEE_ROUTER_ADDRESS: ROUTER,
      },
      {
        token: `${TOKEN}` as `0x${string}`,
        tokenAmount: 1n,
        trader: `${TRADER}` as `0x${string}`,
      },
    );

    const [, init] = fetchSpy.mock.calls[0] as [unknown, RequestInit];
    const body = JSON.parse(init.body as string) as {
      method: string;
      params: [{ to: string; data: string }, string];
    };
    expect(body.method).toBe("eth_call");
    expect(body.params[0].to.toLowerCase()).toBe(ROUTER.toLowerCase());
    expect(body.params[0].data.startsWith("0x")).toBe(true);
  });

  it("returns `reverted` when the simulation reverts", async () => {
    fetchSpy.mockResolvedValue(
      rpcRevert(encodeStringRevert("ERC20InsufficientAllowance")),
    );

    const result = await simulateSellWithBotFee(
      {
        HYPEREVM_RPC_URL: RPC_URL,
        BOT_FEE_ROUTER_ADDRESS: ROUTER,
      },
      {
        token: `${TOKEN}` as `0x${string}`,
        tokenAmount: 1n,
        trader: `${TRADER}` as `0x${string}`,
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("reverted");
  });

  it("returns `unavailable` on a network failure", async () => {
    fetchSpy.mockRejectedValue(new Error("fetch failed"));

    const result = await simulateSellWithBotFee(
      {
        HYPEREVM_RPC_URL: RPC_URL,
        BOT_FEE_ROUTER_ADDRESS: ROUTER,
      },
      {
        token: `${TOKEN}` as `0x${string}`,
        tokenAmount: 1n,
        trader: `${TRADER}` as `0x${string}`,
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("unavailable");
  });
});

describe("computeMinUsdcOut", () => {
  it("applies the slippage bound to the quote", () => {
    // 100 USDC quote @ 100 bps (1%) slippage → 99 USDC bound.
    expect(computeMinUsdcOut(100_000_000n, 100)).toBe(99_000_000n);
  });

  it("returns 0 when the quote is 0 (avoids 1-wei floor on a no-op)", () => {
    expect(computeMinUsdcOut(0n, 100)).toBe(0n);
  });

  it("floors at 1 wei when the quote is positive but slippage rounding would zero it out", () => {
    // quote=1, slippage=10000bps → bound would round to 0 → 1.
    expect(computeMinUsdcOut(1n, 9999)).toBe(1n);
  });

  it("passes through the full quote when slippageBps is 0", () => {
    expect(computeMinUsdcOut(123_456_789n, 0)).toBe(123_456_789n);
  });

  it("rejects out-of-range slippageBps", () => {
    expect(() => computeMinUsdcOut(100n, -1)).toThrow();
    expect(() => computeMinUsdcOut(100n, 10_001)).toThrow();
  });
});

describe("usdcRawToNumber", () => {
  it("converts 6-dp raw to a plain dollars number", () => {
    expect(usdcRawToNumber(12_500_000n)).toBe(12.5);
  });
});

describe("simulateBuyWithBotFee", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("returns `not_configured` when BOT_FEE_ROUTER_ADDRESS is unset", async () => {
    const result = await simulateBuyWithBotFee(
      { HYPEREVM_RPC_URL: RPC_URL },
      {
        token: `${TOKEN}` as `0x${string}`,
        usdcAmount: 20_000_000n,
        trader: `${TRADER}` as `0x${string}`,
      },
    );
    expect(result).toEqual({ ok: false, kind: "not_configured" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("decodes a successful simulation into quotedTokensOut", async () => {
    // 1 token (18-dp) of tokensOut.
    fetchSpy.mockResolvedValue(rpcOk(encodeUint256(10n ** 18n)));

    const result = await simulateBuyWithBotFee(
      {
        HYPEREVM_RPC_URL: RPC_URL,
        BOT_FEE_ROUTER_ADDRESS: ROUTER,
      },
      {
        token: `${TOKEN}` as `0x${string}`,
        usdcAmount: 20_000_000n,
        trader: `${TRADER}` as `0x${string}`,
      },
    );
    expect(result).toEqual({ ok: true, quotedTokensOut: 10n ** 18n });
  });

  it("targets the BOT_FEE_ROUTER_ADDRESS in the eth_call", async () => {
    fetchSpy.mockResolvedValue(rpcOk(encodeUint256(1n)));

    await simulateBuyWithBotFee(
      {
        HYPEREVM_RPC_URL: RPC_URL,
        BOT_FEE_ROUTER_ADDRESS: ROUTER,
      },
      {
        token: `${TOKEN}` as `0x${string}`,
        usdcAmount: 20_000_000n,
        trader: `${TRADER}` as `0x${string}`,
      },
    );

    const [, init] = fetchSpy.mock.calls[0] as [unknown, RequestInit];
    const body = JSON.parse(init.body as string) as {
      method: string;
      params: [{ to: string }, string];
    };
    expect(body.method).toBe("eth_call");
    expect(body.params[0].to.toLowerCase()).toBe(ROUTER.toLowerCase());
  });

  it("returns `reverted` when the simulation reverts", async () => {
    fetchSpy.mockResolvedValue(
      rpcRevert(encodeStringRevert("TradingNotOpen")),
    );
    const result = await simulateBuyWithBotFee(
      {
        HYPEREVM_RPC_URL: RPC_URL,
        BOT_FEE_ROUTER_ADDRESS: ROUTER,
      },
      {
        token: `${TOKEN}` as `0x${string}`,
        usdcAmount: 20_000_000n,
        trader: `${TRADER}` as `0x${string}`,
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("reverted");
  });
});

describe("computeMinTokensOut", () => {
  it("applies the slippage bound to the quote", () => {
    expect(computeMinTokensOut(100n * 10n ** 18n, 100)).toBe(99n * 10n ** 18n);
  });

  it("returns 0 when the quote is 0", () => {
    expect(computeMinTokensOut(0n, 100)).toBe(0n);
  });

  it("floors at 1 wei when slippage rounding would zero a positive quote", () => {
    expect(computeMinTokensOut(1n, 9999)).toBe(1n);
  });

  it("rejects out-of-range slippageBps", () => {
    expect(() => computeMinTokensOut(100n, -1)).toThrow();
    expect(() => computeMinTokensOut(100n, 10_001)).toThrow();
  });
});

describe("renderExecutionError", () => {
  it("maps not_configured to a user-facing copy", () => {
    expect(
      renderExecutionError({ ok: false, kind: "not_configured" }),
    ).toMatch(/not yet configured/i);
  });

  it("maps insufficient_funds to top-up copy", () => {
    expect(
      renderExecutionError({
        ok: false,
        kind: "insufficient_funds",
        reason: "x",
      }),
    ).toMatch(/HYPE for gas/i);
  });

  it("maps TradingNotOpen revert to launch-delay copy", () => {
    expect(
      renderExecutionError({
        ok: false,
        kind: "reverted",
        reason: "TradingNotOpen",
      }),
    ).toMatch(/Trading not yet open/i);
  });

  it("maps InsufficientBalance revert to LT-buffer copy", () => {
    expect(
      renderExecutionError({
        ok: false,
        kind: "reverted",
        reason: "InsufficientBalance",
      }),
    ).toMatch(/buffer low/i);
  });

  it("maps Slippage revert to slippage copy", () => {
    expect(
      renderExecutionError({
        ok: false,
        kind: "reverted",
        reason: "SlippageExceeded",
      }),
    ).toMatch(/Price moved/i);
  });

  it("maps mint-pause revert to LT-paused copy", () => {
    expect(
      renderExecutionError({
        ok: false,
        kind: "reverted",
        reason: "MintPaused",
      }),
    ).toMatch(/Buys paused/i);
  });

  it("falls back to a generic failure for unknown reverts", () => {
    expect(
      renderExecutionError({
        ok: false,
        kind: "reverted",
        reason: "MysteryError",
      }),
    ).toMatch(/Transaction failed/i);
  });
});

describe("awaitReceipt", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  const TX_HASH =
    "0x8edc611c82129c8acd78782811d155d72e219d01dd06eeb9c208f6a11919f473" as const;

  // viem's `eth_getTransactionReceipt` response shape — only the fields
  // `waitForTransactionReceipt` reads (status + blockHash + blockNumber).
  const receiptResponse = (status: "0x0" | "0x1"): Response =>
    new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: {
          transactionHash: TX_HASH,
          blockNumber: "0x1",
          blockHash:
            "0x0000000000000000000000000000000000000000000000000000000000000001",
          transactionIndex: "0x0",
          from: TRADER,
          to: ROUTER,
          cumulativeGasUsed: "0x1",
          gasUsed: "0x1",
          contractAddress: null,
          logs: [],
          logsBloom: `0x${"0".repeat(512)}`,
          status,
          type: "0x0",
          effectiveGasPrice: "0x1",
        },
      }),
      { status: 200 },
    );

  // Minimum viable `eth_blockNumber` response — viem polls this to know
  // when to re-fetch the receipt.
  const blockNumberResponse = (): Response =>
    new Response(
      JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x2" }),
      { status: 200 },
    );

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });

  /** Route RPC calls by `method`. Receipt-or-block routing only — enough
   *  for `waitForTransactionReceipt` to settle. */
  const routeRpc = (txStatus: "0x0" | "0x1" | "not_found") => async (
    _input: unknown,
    init?: RequestInit,
  ): Promise<Response> => {
    const body = JSON.parse(init?.body as string) as { method: string };
    if (body.method === "eth_getTransactionReceipt") {
      if (txStatus === "not_found") {
        return new Response(
          JSON.stringify({ jsonrpc: "2.0", id: 1, result: null }),
          { status: 200 },
        );
      }
      return receiptResponse(txStatus);
    }
    if (body.method === "eth_blockNumber") {
      return blockNumberResponse();
    }
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x" }),
      { status: 200 },
    );
  };

  it("returns ok:true when the receipt status is success", async () => {
    fetchSpy.mockImplementation(routeRpc("0x1") as never);
    const client = buildPublicClient({ HYPEREVM_RPC_URL: RPC_URL });

    const result = await awaitReceipt(client, TX_HASH, {
      quotedOut: 42n,
      minOut: 41n,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.txHash).toBe(TX_HASH);
      expect(result.quotedOut).toBe(42n);
      expect(result.minOut).toBe(41n);
    }
  });

  it("returns ok:false kind:pending with txHash when the receipt poll times out", async () => {
    // The reviewer comment that prompted this fix: a 20s RECEIPT_TIMEOUT_MS
    // expiry must surface as a neutral "tx pending" outcome carrying the
    // hash, not as an `unavailable` failure. The hash is the user's only
    // affordance for checking the explorer themselves while the tx is
    // still mining, so it MUST be set on the result.
    //
    // We mock `waitForTransactionReceipt` directly instead of letting viem
    // poll a never-mining receipt for 20s — the timeout window is fixed
    // module-level, so simulating real elapsed time would make this test
    // a wall-clock dependency.
    const client = buildPublicClient({ HYPEREVM_RPC_URL: RPC_URL });
    const timeoutErr = new WaitForTransactionReceiptTimeoutError({
      hash: TX_HASH,
    });
    const waitSpy = vi
      .spyOn(client, "waitForTransactionReceipt")
      .mockRejectedValue(timeoutErr);

    const result = await awaitReceipt(client, TX_HASH, {
      quotedOut: 0n,
      minOut: 0n,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("pending");
      expect(result.txHash).toBe(TX_HASH);
    }
    waitSpy.mockRestore();
  });

  it("returns ok:false kind:unavailable with txHash for non-timeout RPC errors", async () => {
    // Non-timeout errors (network drop, RPC 5xx, malformed response)
    // must keep the `unavailable` kind — only `WaitForTransactionReceiptTimeoutError`
    // collapses to `pending`. This guards against future refactors that
    // accidentally widen the pending path to swallow real failures.
    const client = buildPublicClient({ HYPEREVM_RPC_URL: RPC_URL });
    const waitSpy = vi
      .spyOn(client, "waitForTransactionReceipt")
      .mockRejectedValue(new Error("HTTP 503: upstream connect timeout"));

    const result = await awaitReceipt(client, TX_HASH, {
      quotedOut: 0n,
      minOut: 0n,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("unavailable");
      expect(result.txHash).toBe(TX_HASH);
    }
    waitSpy.mockRestore();
  });

  it("decodes actualTokensOut from the BotRouterTrade log on a successful buy", async () => {
    // Issue #802: confirm message must include the on-chain tokens the
    // user actually received. The router emits one `BotRouterTrade` per
    // trade with `tokenAmount` set to the tokens transferred to the
    // trader on a buy. awaitReceipt decodes that log when invoked with
    // `side: "buy"` so the caller can render "Received N TICKER".
    const TOKENS_RECEIVED = 1_234_500_000_000_000_000_000n; // 1234.5 * 1e18
    const ZERO = "0x0000000000000000000000000000000000000000" as const;
    const topics = encodeEventTopics({
      abi: BotFeeRouterAbi,
      eventName: "BotRouterTrade",
      args: { trader: TRADER, token: TOKEN, referrer: ZERO },
    });
    // Non-indexed payload: side, usdcAmount, tokenAmount, botFee, referrerCut, treasuryCut.
    const data = encodeAbiParameters(
      [
        { type: "uint8" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
      ],
      [0, 20_000_000n, TOKENS_RECEIVED, 100_000n, 0n, 100_000n],
    );
    const receiptWithLog: Response = new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: {
          transactionHash: TX_HASH,
          blockNumber: "0x1",
          blockHash:
            "0x0000000000000000000000000000000000000000000000000000000000000001",
          transactionIndex: "0x0",
          from: TRADER,
          to: ROUTER,
          cumulativeGasUsed: "0x1",
          gasUsed: "0x1",
          contractAddress: null,
          logs: [
            {
              address: ROUTER,
              topics,
              data,
              blockNumber: "0x1",
              transactionHash: TX_HASH,
              transactionIndex: "0x0",
              blockHash:
                "0x0000000000000000000000000000000000000000000000000000000000000001",
              logIndex: "0x0",
              removed: false,
            },
          ],
          logsBloom: `0x${"0".repeat(512)}`,
          status: "0x1",
          type: "0x0",
          effectiveGasPrice: "0x1",
        },
      }),
      { status: 200 },
    );
    fetchSpy.mockImplementation(async (_input: unknown, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string) as { method: string };
      if (body.method === "eth_getTransactionReceipt") return receiptWithLog;
      if (body.method === "eth_blockNumber") return blockNumberResponse();
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x" }),
        { status: 200 },
      );
    });
    const client = buildPublicClient({ HYPEREVM_RPC_URL: RPC_URL });

    const result = await awaitReceipt(client, TX_HASH, {
      quotedOut: 1_200n * 10n ** 18n,
      minOut: 1_100n * 10n ** 18n,
      side: "buy",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.actualTokensOut).toBe(TOKENS_RECEIVED);
    }
  });

  it("leaves actualTokensOut undefined when side is omitted (sell path)", async () => {
    // Sell side: `BotRouterTrade.tokenAmount` is tokens *sold*, not
    // received, so the buy-only `actualTokensOut` field must stay
    // undefined for sells to avoid mislabelling. The current call sites
    // pass `side: "sell"` from executeSell and no side from legacy
    // callers — both should leave the field unset.
    fetchSpy.mockImplementation(routeRpc("0x1") as never);
    const client = buildPublicClient({ HYPEREVM_RPC_URL: RPC_URL });

    const result = await awaitReceipt(client, TX_HASH, {
      quotedOut: 1n,
      minOut: 1n,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.actualTokensOut).toBeUndefined();
    }
  });

  it("returns ok:false kind:reverted with txHash when the receipt is reverted", async () => {
    // This is the bug the fix targets: sendTransaction returns a hash for
    // a tx that reverts on-chain (e.g. CHAOS buy 0x8edc611c…), and the
    // bot previously rendered "✅ submitted" because it never checked
    // the receipt. After the fix, a reverted receipt MUST surface as a
    // failure with the txHash echoed so the user-facing error can link
    // to the explorer.
    fetchSpy.mockImplementation(routeRpc("0x0") as never);
    const client = buildPublicClient({ HYPEREVM_RPC_URL: RPC_URL });

    const result = await awaitReceipt(client, TX_HASH, {
      quotedOut: 1n,
      minOut: 1n,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("reverted");
      expect(result.txHash).toBe(TX_HASH);
    }
  });
});

describe("renderExecutionError with on-chain revert", () => {
  it("renders explorer link when a reverted result carries a txHash", () => {
    const reply = renderExecutionError({
      ok: false,
      kind: "reverted",
      reason: "MysteryError",
      txHash:
        "0x8edc611c82129c8acd78782811d155d72e219d01dd06eeb9c208f6a11919f473",
    });
    expect(reply).toMatch(/Transaction reverted on-chain/i);
    expect(reply).toContain(
      "hyperevmscan.io/tx/0x8edc611c82129c8acd78782811d155d72e219d01dd06eeb9c208f6a11919f473",
    );
  });

  it("appends the explorer link to mapped revert copy when a txHash is present", () => {
    const reply = renderExecutionError({
      ok: false,
      kind: "reverted",
      reason: "SlippageExceeded",
      txHash:
        "0x8edc611c82129c8acd78782811d155d72e219d01dd06eeb9c208f6a11919f473",
    });
    expect(reply).toMatch(/Price moved/);
    expect(reply).toContain("hyperevmscan.io/tx/0x8edc611c");
  });

  it("renders an explorer link for an unavailable result that carries a txHash", () => {
    const reply = renderExecutionError({
      ok: false,
      kind: "unavailable",
      reason: "WaitForTransactionReceiptTimeoutError",
      txHash:
        "0x8edc611c82129c8acd78782811d155d72e219d01dd06eeb9c208f6a11919f473",
    });
    expect(reply).toMatch(/receipt not seen/i);
    expect(reply).toContain("hyperevmscan.io/tx/0x8edc611c");
  });

  it("renders a neutral pending message with explorer link when receipt times out", () => {
    // `pending` is the receipt-timeout case: tx is in mempool, may still
    // mine. Copy must read as "pending — check explorer", not as a
    // failure. The caller in execute.ts is responsible for the ⏳ prefix
    // (see `renderConfirmReply`) — renderExecutionError just owns the
    // body copy.
    const reply = renderExecutionError({
      ok: false,
      kind: "pending",
      reason: "WaitForTransactionReceiptTimeoutError",
      txHash:
        "0x8edc611c82129c8acd78782811d155d72e219d01dd06eeb9c208f6a11919f473",
    });
    expect(reply).toMatch(/pending/i);
    expect(reply).toMatch(/check the explorer/i);
    // Must not read as a failure — no "failed" / "reverted" / "❌" copy.
    expect(reply).not.toMatch(/failed|reverted|❌/i);
    expect(reply).toContain("hyperevmscan.io/tx/0x8edc611c");
  });
});

describe("executeBuy idempotency", () => {
  // Deterministic dev key — same one used elsewhere in this file.
  const PRIVATE_KEY =
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
  const TRADER_FOR_KEY = privateKeyToAccount(PRIVATE_KEY).address;
  const TX_HASH_SUCCESS =
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;

  /**
   * Tiny in-memory KV usable as both a sink (assert the writes happen) and
   * a source (pre-populate to simulate a retry hitting an existing entry).
   * Records every put so the test can verify TTL plumbing without coupling
   * to the Cloudflare KV type.
   */
  class InMemoryKv implements IdempotencyKv {
    readonly puts: Array<{
      key: string;
      value: string;
      options?: { expirationTtl?: number };
    }> = [];
    private readonly store = new Map<string, string>();
    constructor(seed: Record<string, string> = {}) {
      for (const [k, v] of Object.entries(seed)) this.store.set(k, v);
    }
    async get(key: string): Promise<string | null> {
      return this.store.get(key) ?? null;
    }
    async put(
      key: string,
      value: string,
      options?: { expirationTtl?: number },
    ): Promise<void> {
      this.puts.push({ key, value, options });
      this.store.set(key, value);
    }
  }

  /**
   * Default RPC router for the executeBuy happy path: allowance is
   * `MAX_UINT256` (so the permit/approve branch is skipped), the simulate
   * call returns a non-zero quote, `eth_estimateGas` returns a sane value,
   * and a successful receipt is delivered for any submitted tx. Tests can
   * decorate this to assert what was sent or to reject calls that mustn't
   * happen on a dedupe path.
   */
  const makeFetch = (opts: {
    onSendRaw?: (raw: string) => Response | Promise<Response>;
  } = {}) =>
    async (_input: unknown, init?: RequestInit): Promise<Response> => {
      const body = JSON.parse(init?.body as string) as {
        method: string;
        params: unknown;
      };
      switch (body.method) {
        case "eth_chainId":
          return new Response(
            JSON.stringify({ jsonrpc: "2.0", id: 1, result: `0x${HYPER_EVM.id.toString(16)}` }),
            { status: 200 },
          );
        case "eth_call":
          // Both `allowance` and `simulateContract` reach here. Returning
          // a very large uint256 satisfies both: it caps `allowance >=
          // usdcAmount` (skip approve) and stands in as the simulate
          // result (`quotedTokensOut`). The buy path doesn't care about
          // distinguishing them in this test.
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              result: encodeUint256((1n << 200n) - 1n),
            }),
            { status: 200 },
          );
        case "eth_estimateGas":
          return new Response(
            JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x5208" }),
            { status: 200 },
          );
        case "eth_gasPrice":
          return new Response(
            JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x1" }),
            { status: 200 },
          );
        case "eth_getTransactionCount":
          return new Response(
            JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0" }),
            { status: 200 },
          );
        case "eth_maxPriorityFeePerGas":
          return new Response(
            JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0" }),
            { status: 200 },
          );
        case "eth_getBlockByNumber":
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              result: { baseFeePerGas: "0x1", number: "0x1" },
            }),
            { status: 200 },
          );
        case "eth_sendRawTransaction": {
          const raw = (body.params as [string])[0];
          if (opts.onSendRaw) return opts.onSendRaw(raw);
          return new Response(
            JSON.stringify({ jsonrpc: "2.0", id: 1, result: TX_HASH_SUCCESS }),
            { status: 200 },
          );
        }
        case "eth_blockNumber":
          return new Response(
            JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x2" }),
            { status: 200 },
          );
        case "eth_getTransactionReceipt":
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              result: {
                transactionHash: TX_HASH_SUCCESS,
                blockNumber: "0x1",
                blockHash:
                  "0x0000000000000000000000000000000000000000000000000000000000000001",
                transactionIndex: "0x0",
                from: TRADER_FOR_KEY,
                to: ROUTER,
                cumulativeGasUsed: "0x1",
                gasUsed: "0x1",
                contractAddress: null,
                logs: [],
                logsBloom: `0x${"0".repeat(512)}`,
                status: "0x1",
                type: "0x0",
                effectiveGasPrice: "0x1",
              },
            }),
            { status: 200 },
          );
        default:
          throw new Error(`unexpected RPC method ${body.method}`);
      }
    };

  let fetchSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("does NOT submit a second tx when the commit-log records a completed result on retry", async () => {
    // Pre-populate KV with a completed record — same shape `markFinal`
    // would have written on the original attempt. The retry must read
    // this and return it verbatim, without ever calling
    // `eth_sendRawTransaction` again. This is the core double-spend fix:
    // even if grammY's session write was lost and `pendingTrade` is
    // still set on the second DO turn, KV remembers the result.
    const key = intentKey(7, "n-retry");
    const kv = new InMemoryKv();
    await markFinal(kv, key, {
      ok: true,
      txHash: TX_HASH_SUCCESS,
      quotedOut: "1000",
      minOut: "990",
    });

    // Reject sendRaw at the RPC level too — defense-in-depth so a
    // regression that bypasses the KV check still fails the test.
    fetchSpy.mockImplementation(
      makeFetch({
        onSendRaw: () => {
          throw new Error("must not submit a duplicate tx on retry");
        },
      }) as never,
    );

    const result = await executeBuy(
      { HYPEREVM_RPC_URL: RPC_URL, BOT_FEE_ROUTER_ADDRESS: ROUTER },
      {
        token: TOKEN as `0x${string}`,
        usdcAmount: 20_000_000n,
        trader: TRADER_FOR_KEY,
        privateKey: PRIVATE_KEY,
        slippageBps: 100,
        idempotency: { kv, key },
      },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.txHash).toBe(TX_HASH_SUCCESS);
      expect(result.quotedOut).toBe(1000n);
      expect(result.minOut).toBe(990n);
    }
    // Hard guarantee: zero `eth_sendRawTransaction` calls in the RPC log.
    const sendCalls = fetchSpy.mock.calls.filter((c: unknown[]) => {
      const init = c[1] as RequestInit | undefined;
      if (!init?.body) return false;
      const body = JSON.parse(init.body as string) as { method: string };
      return body.method === "eth_sendRawTransaction";
    });
    expect(sendCalls).toHaveLength(0);
  });

  it("re-awaits the receipt without re-submitting when the prior attempt recorded a hash but no final result", async () => {
    // Simulates the worst-case race the fix is built for: original turn
    // landed `sendTransaction` (we have a hash on disk) but never wrote
    // the final result (Worker killed during the receipt-wait). The
    // retry must NOT submit a new tx; it should re-await the existing
    // hash's receipt and surface the on-chain outcome.
    const key = intentKey(7, "n-submitted");
    const kv = new InMemoryKv();
    await markSubmitted(kv, key, TX_HASH_SUCCESS);

    fetchSpy.mockImplementation(
      makeFetch({
        onSendRaw: () => {
          throw new Error("must not resubmit when a prior hash exists");
        },
      }) as never,
    );

    const result = await executeBuy(
      { HYPEREVM_RPC_URL: RPC_URL, BOT_FEE_ROUTER_ADDRESS: ROUTER },
      {
        token: TOKEN as `0x${string}`,
        usdcAmount: 20_000_000n,
        trader: TRADER_FOR_KEY,
        privateKey: PRIVATE_KEY,
        slippageBps: 100,
        idempotency: { kv, key },
      },
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.txHash).toBe(TX_HASH_SUCCESS);
  });

  it("refuses to resubmit when the prior attempt claimed the slot but never recorded a hash", async () => {
    // Original turn died after claiming but before `sendTransaction`
    // returned — we have no hash to re-await. Returning `unavailable`
    // is the safe choice; the only alternative is to fire a second tx,
    // which is the bug. The TTL on the commit-log gives the slot a
    // bounded lifetime so a permanently-stuck claim cannot lock the
    // user out forever.
    const key = intentKey(7, "n-stuck");
    const kv = new InMemoryKv();
    await kv.put(
      key,
      JSON.stringify({ status: "submitting", claimedAt: Date.now() }),
      { expirationTtl: INTENT_TTL_SECONDS },
    );

    fetchSpy.mockImplementation(
      makeFetch({
        onSendRaw: () => {
          throw new Error("must not submit while a prior claim is in flight");
        },
      }) as never,
    );

    const result = await executeBuy(
      { HYPEREVM_RPC_URL: RPC_URL, BOT_FEE_ROUTER_ADDRESS: ROUTER },
      {
        token: TOKEN as `0x${string}`,
        usdcAmount: 20_000_000n,
        trader: TRADER_FOR_KEY,
        privateKey: PRIVATE_KEY,
        slippageBps: 100,
        idempotency: { kv, key },
      },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("unavailable");
      expect(result.reason ?? "").toMatch(/already in flight/i);
    }
  });

  it("happy path: claims the slot, submits, records the hash, then records the final result", async () => {
    const key = intentKey(7, "n-happy");
    const kv = new InMemoryKv();
    fetchSpy.mockImplementation(makeFetch() as never);

    const result = await executeBuy(
      { HYPEREVM_RPC_URL: RPC_URL, BOT_FEE_ROUTER_ADDRESS: ROUTER },
      {
        token: TOKEN as `0x${string}`,
        usdcAmount: 20_000_000n,
        trader: TRADER_FOR_KEY,
        privateKey: PRIVATE_KEY,
        slippageBps: 100,
        idempotency: { kv, key },
      },
    );

    expect(result.ok).toBe(true);
    // Three writes: claim → submitted → final.
    const writesForKey = kv.puts.filter((p) => p.key === key);
    expect(writesForKey).toHaveLength(3);
    expect(JSON.parse(writesForKey[0].value).status).toBe("submitting");
    expect(JSON.parse(writesForKey[1].value).status).toBe("submitted");
    expect(JSON.parse(writesForKey[2].value).status).toBe("completed");
    // Every write must carry the TTL so the slot doesn't leak forever.
    for (const w of writesForKey) {
      expect(w.options?.expirationTtl).toBe(INTENT_TTL_SECONDS);
    }
  });
});

describe("explorerTxUrl", () => {
  it("builds a hyperevmscan tx URL", () => {
    expect(
      explorerTxUrl(
        "0xdeadbeef000000000000000000000000000000000000000000000000000000ab",
      ),
    ).toBe(
      "https://hyperevmscan.io/tx/0xdeadbeef000000000000000000000000000000000000000000000000000000ab",
    );
  });
});

describe("signPermitForRouter", () => {
  // Deterministic dev key — never used outside tests. The matching EOA
  // address is what we assert against `recoverTypedDataAddress`.
  const PRIVATE_KEY =
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
  const OWNER = privateKeyToAccount(PRIVATE_KEY).address;
  const SPENDER = "0xB2b2d9c0c837a723fC27C27e097B384400796947" as const;
  const TOKEN_NAME = "Test USDC";
  const NONCE = 7n;

  /** Selector-aware router for the three reads `signPermitForRouter` makes. */
  const makeFetchRouter = (opts: {
    name?: string;
    nonce?: bigint;
    domainSep?: `0x${string}`;
    revertOnNonces?: boolean;
  }) =>
    async (_input: unknown, init?: RequestInit): Promise<Response> => {
      const body = JSON.parse(init?.body as string) as {
        method: string;
        params: [{ data: string }, string];
      };
      if (body.method !== "eth_call") {
        throw new Error(`unexpected RPC method ${body.method}`);
      }
      const selector = body.params[0].data.slice(0, 10).toLowerCase();
      // name()
      if (selector === "0x06fdde03") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: encodeAbiParameters(
              [{ type: "string" }],
              [opts.name ?? TOKEN_NAME],
            ),
          }),
          { status: 200 },
        );
      }
      // nonces(address)
      if (selector === "0x7ecebe00") {
        if (opts.revertOnNonces) {
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              error: {
                code: 3,
                message: "execution reverted",
                data: "0x",
              },
            }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: encodeAbiParameters(
              [{ type: "uint256" }],
              [opts.nonce ?? NONCE],
            ),
          }),
          { status: 200 },
        );
      }
      // DOMAIN_SEPARATOR()
      if (selector === "0x3644e515") {
        const sep =
          opts.domainSep ??
          ("0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`);
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: sep,
          }),
          { status: 200 },
        );
      }
      throw new Error(`unhandled selector ${selector}`);
    };

  let fetchSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("signs a permit whose signature recovers to the owner EOA", async () => {
    // Token uses OZ's `ERC20Permit` (version "1"); compute the matching
    // on-chain DOMAIN_SEPARATOR so the in-sign cross-check passes.
    const TOKEN = "0x1111111111111111111111111111111111111111" as const;
    const expectedDomain = domainSeparator({
      domain: {
        name: TOKEN_NAME,
        version: "1",
        chainId: HYPER_EVM.id,
        verifyingContract: TOKEN,
      },
    });
    fetchSpy.mockImplementation(
      makeFetchRouter({ domainSep: expectedDomain }) as never,
    );

    const client = buildPublicClient({ HYPEREVM_RPC_URL: "https://rpc.test" });
    const deadline = 9_999_999_999n;
    const value = 100n * 10n ** 6n;
    const sig = await signPermitForRouter(client, PRIVATE_KEY, {
      token: TOKEN,
      owner: OWNER,
      spender: SPENDER,
      value,
      deadline,
    });

    expect(sig.value).toBe(value);
    expect(sig.deadline).toBe(deadline);
    expect(sig.v === 27 || sig.v === 28).toBe(true);
    expect(sig.r.startsWith("0x")).toBe(true);
    expect(sig.s.startsWith("0x")).toBe(true);

    // Reassemble the signature and recover the signer — must be the
    // owner EOA, otherwise `permit()` would fail `ecrecover` on-chain.
    const yParity = sig.v === 27 ? 0 : 1;
    const signatureHex =
      `${sig.r}${sig.s.slice(2)}${yParity === 0 ? "1b" : "1c"}` as `0x${string}`;
    const recovered = await recoverTypedDataAddress({
      domain: {
        name: TOKEN_NAME,
        version: "1",
        chainId: HYPER_EVM.id,
        verifyingContract: TOKEN,
      },
      types: {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      primaryType: "Permit",
      message: {
        owner: OWNER,
        spender: SPENDER,
        value,
        nonce: NONCE,
        deadline,
      },
      signature: signatureHex,
    });
    expect(recovered.toLowerCase()).toBe(OWNER.toLowerCase());
  });

  it("uses version \"2\" for USDC (FiatTokenV2_2)", async () => {
    // On-chain separator must match the version-2 domain for USDC,
    // otherwise the cross-check throws — which is what this test
    // verifies a healthy USDC path does NOT do.
    const expectedDomain = domainSeparator({
      domain: {
        name: TOKEN_NAME,
        version: "2",
        chainId: HYPER_EVM.id,
        verifyingContract: USDC_ADDRESS as `0x${string}`,
      },
    });
    fetchSpy.mockImplementation(
      makeFetchRouter({ domainSep: expectedDomain }) as never,
    );

    const client = buildPublicClient({ HYPEREVM_RPC_URL: "https://rpc.test" });
    const sig = await signPermitForRouter(client, PRIVATE_KEY, {
      token: USDC_ADDRESS as `0x${string}`,
      owner: OWNER,
      spender: SPENDER,
      value: 1n,
      deadline: 1n,
    });
    expect(sig.v === 27 || sig.v === 28).toBe(true);
  });

  it("throws when the on-chain DOMAIN_SEPARATOR does not match the computed one", async () => {
    // Wrong sep (zero hash) → cross-check throws — the callers in
    // `executeBuy` / `executeSell` catch this and fall back to approve.
    fetchSpy.mockImplementation(
      makeFetchRouter({
        domainSep:
          "0xdeadbeef00000000000000000000000000000000000000000000000000000000" as `0x${string}`,
      }) as never,
    );
    const client = buildPublicClient({ HYPEREVM_RPC_URL: "https://rpc.test" });
    await expect(
      signPermitForRouter(client, PRIVATE_KEY, {
        token: "0x1111111111111111111111111111111111111111",
        owner: OWNER,
        spender: SPENDER,
        value: 1n,
        deadline: 1n,
      }),
    ).rejects.toThrow(/domain mismatch/i);
  });

  it("throws when `nonces` reverts (pre-permit token vintage)", async () => {
    fetchSpy.mockImplementation(
      makeFetchRouter({ revertOnNonces: true }) as never,
    );
    const client = buildPublicClient({ HYPEREVM_RPC_URL: "https://rpc.test" });
    await expect(
      signPermitForRouter(client, PRIVATE_KEY, {
        token: "0x2222222222222222222222222222222222222222",
        owner: OWNER,
        spender: SPENDER,
        value: 1n,
        deadline: 1n,
      }),
    ).rejects.toThrow();
  });
});

describe("tryPermit", () => {
  // Regression for `0x4b800e46 ERC2612InvalidSigner` reverts on
  // `sellWithBotFeePermit` / `buyWithBotFeePermit`. The on-chain router
  // calls `permit(owner, spender, tradeAmount, deadline, v, r, s)` —
  // passing the trade amount as the permit `value` directly, not a
  // separately-signed field as `Zap.{buy,sell}WithPermit` does. Signing
  // anything other than the trade amount (the prior code hard-coded
  // `maxUint256`) makes the EIP-712 digest diverge from what the contract
  // reconstructs, `ecrecover` returns the wrong signer, and the call
  // reverts. This test pins the invariant: `tryPermit` MUST forward the
  // caller's `value` verbatim into the signed digest.
  const PRIVATE_KEY =
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
  const OWNER = privateKeyToAccount(PRIVATE_KEY).address;
  const SPENDER = "0xB2b2d9c0c837a723fC27C27e097B384400796947" as const;
  const TOKEN = "0x1111111111111111111111111111111111111111" as const;
  const TOKEN_NAME = "Test Permit Token";
  const NONCE = 3n;

  let fetchSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });

  const stubRpc = () => {
    const domainSep = domainSeparator({
      domain: {
        name: TOKEN_NAME,
        version: "1",
        chainId: HYPER_EVM.id,
        verifyingContract: TOKEN,
      },
    });
    fetchSpy.mockImplementation((async (_input: unknown, init?: RequestInit) => {
      const body = JSON.parse((init?.body as string) ?? "{}") as {
        method: string;
        params: [{ data: string }, string];
      };
      const selector = body.params[0].data.slice(0, 10).toLowerCase();
      if (selector === "0x06fdde03") {
        return rpcOk(encodeAbiParameters([{ type: "string" }], [TOKEN_NAME]));
      }
      if (selector === "0x7ecebe00") {
        return rpcOk(encodeUint256(NONCE));
      }
      if (selector === "0x3644e515") {
        return rpcOk(domainSep);
      }
      throw new Error(`unhandled selector ${selector}`);
    }) as never);
  };

  it("signs over the caller-supplied trade amount, never `maxUint256`", async () => {
    stubRpc();
    const client = buildPublicClient({ HYPEREVM_RPC_URL: RPC_URL });
    // Pick a value that is small and distinct so a regression hard-coding
    // `maxUint256` (or any other constant) breaks the equality.
    const tradeAmount = 12345n;
    const deadline = 9_999_999_999n;
    const sig = await tryPermit(client, PRIVATE_KEY, {
      token: TOKEN,
      owner: OWNER,
      spender: SPENDER,
      value: tradeAmount,
      deadline,
    });
    expect(sig).not.toBeNull();
    // The returned signature must report the same value it was asked to
    // sign — proves tryPermit forwarded `value` verbatim into the digest.
    expect(sig!.value).toBe(tradeAmount);

    // Independent cross-check: rebuild the typed data with `value =
    // tradeAmount` (mirroring what the BotFeeRouter reconstructs on
    // chain) and verify the signature recovers to the owner.
    const yParity = sig!.v === 27 ? 0 : 1;
    const signatureHex =
      `${sig!.r}${sig!.s.slice(2)}${yParity === 0 ? "1b" : "1c"}` as `0x${string}`;
    const recovered = await recoverTypedDataAddress({
      domain: {
        name: TOKEN_NAME,
        version: "1",
        chainId: HYPER_EVM.id,
        verifyingContract: TOKEN,
      },
      types: {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      primaryType: "Permit",
      message: {
        owner: OWNER,
        spender: SPENDER,
        value: tradeAmount,
        nonce: NONCE,
        deadline,
      },
      signature: signatureHex,
    });
    expect(recovered.toLowerCase()).toBe(OWNER.toLowerCase());
  });

  it("signing the wrong value would NOT recover to the owner under the trade-amount digest", async () => {
    // Pin the EIP-712 invariant the router relies on: if `tryPermit` ever
    // regresses to signing a different `value` (e.g. `maxUint256`),
    // recovery against the trade-amount digest the contract uses will
    // fail. The on-chain symptom of that mismatch is `ERC2612InvalidSigner
    // (0x4b800e46)`.
    stubRpc();
    const client = buildPublicClient({ HYPEREVM_RPC_URL: RPC_URL });
    const tradeAmount = 12345n;
    const wrongValue = 2n ** 256n - 1n;
    const deadline = 9_999_999_999n;
    const sig = await tryPermit(client, PRIVATE_KEY, {
      token: TOKEN,
      owner: OWNER,
      spender: SPENDER,
      value: wrongValue,
      deadline,
    });
    expect(sig).not.toBeNull();

    const yParity = sig!.v === 27 ? 0 : 1;
    const signatureHex =
      `${sig!.r}${sig!.s.slice(2)}${yParity === 0 ? "1b" : "1c"}` as `0x${string}`;
    const recovered = await recoverTypedDataAddress({
      domain: {
        name: TOKEN_NAME,
        version: "1",
        chainId: HYPER_EVM.id,
        verifyingContract: TOKEN,
      },
      types: {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      primaryType: "Permit",
      message: {
        owner: OWNER,
        spender: SPENDER,
        // Reconstruct with the trade amount the router will pass in —
        // signed value differs, so recovery must NOT match owner.
        value: tradeAmount,
        nonce: NONCE,
        deadline,
      },
      signature: signatureHex,
    });
    expect(recovered.toLowerCase()).not.toBe(OWNER.toLowerCase());
  });
});
