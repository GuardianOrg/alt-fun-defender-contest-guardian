import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeErrorResult, parseAbi } from "viem";

import {
  computeMinTokensOut,
  computeMinUsdcOut,
  explorerTxUrl,
  renderExecutionError,
  simulateBuyWithBotFee,
  simulateSellWithBotFee,
  usdcRawToNumber,
} from "../../lib/trade.js";

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
