import { parseUnits } from "viem";
import { describe, expect, it } from "vitest";

import {
  HYPEFUEL_USDC_WEI,
  canHypeFuelFromUsdc,
  isHypeFuelRelayFallback,
  needsGas,
  parseHypeFuelError,
  parseTypedUsdcWei,
  planBuyGas,
  planSellGas,
  typedDataForViem,
} from "./hypefuel";

import type { HypeFuelTypedDataJson } from "./hypefuel";

const DOLLAR = 1_000_000n;

describe("parseHypeFuelError", () => {
  it("reads code and message from the relayer envelope", () => {
    const err = parseHypeFuelError(503, {
      error: {
        code: "insufficient_liquidity",
        message: "We only hold enough HYPE for about $2.00 right now.",
      },
    });
    expect(err.code).toBe("insufficient_liquidity");
    expect(err.message).toContain("$2.00");
  });

  it("falls back when the body is not the envelope", () => {
    const err = parseHypeFuelError(500, null);
    expect(err.code).toBe("http_error");
    expect(err.message).toContain("500");
  });
});

describe("isHypeFuelRelayFallback", () => {
  it("flags inventory and oracle failures", () => {
    expect(isHypeFuelRelayFallback("insufficient_liquidity")).toBe(true);
    expect(isHypeFuelRelayFallback("oracle_deviation")).toBe(true);
    expect(isHypeFuelRelayFallback("paused")).toBe(true);
    expect(isHypeFuelRelayFallback("invalid_signature")).toBe(false);
  });
});

describe("typedDataForViem", () => {
  const raw: HypeFuelTypedDataJson = {
    domain: {
      name: "USDC",
      version: "2",
      chainId: 999,
      verifyingContract: "0xb88339CB7199b77E23db6E890353E22632Ba630f",
    },
    types: {
      EIP712Domain: [{ name: "name", type: "string" }],
      ReceiveWithAuthorization: [{ name: "from", type: "address" }],
    },
    primaryType: "ReceiveWithAuthorization",
    message: {
      from: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
      to: "0x42b06b1d9a07Fc3925C518dbf9475E7cA80DC8DF",
      value: "1000000",
      validAfter: "10",
      validBefore: "20",
      nonce:
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
  };

  it("coerces uint256 fields to bigint and drops EIP712Domain", () => {
    const typed = typedDataForViem(raw);
    expect(typed.message.value).toBe(1000000n);
    expect(typed.message.validAfter).toBe(10n);
    expect(typed.message.validBefore).toBe(20n);
    expect(typed.types).not.toHaveProperty("EIP712Domain");
    expect(typed.primaryType).toBe("ReceiveWithAuthorization");
  });
});

describe("parseTypedUsdcWei", () => {
  it("parses 6dp USDC and treats junk as zero", () => {
    expect(parseTypedUsdcWei("20")).toBe(20n * DOLLAR);
    expect(parseTypedUsdcWei("20.50")).toBe(20n * DOLLAR + 500_000n);
    expect(parseTypedUsdcWei("")).toBe(0n);
    expect(parseTypedUsdcWei("nope")).toBe(0n);
  });
});

describe("planBuyGas", () => {
  it("does not intercept an empty amount", () => {
    expect(planBuyGas(100n * DOLLAR, 0n).action).toBe("none");
  });

  it("does not rewrite an underfunded buy", () => {
    const plan = planBuyGas(50n * DOLLAR, 100n * DOLLAR);
    expect(plan.action).toBe("none");
    expect(plan.haircut).toBe(false);
    expect(plan.proposedBuyUsdcWei).toBe(100n * DOLLAR);
  });

  it("keeps the typed size when leftover covers $1", () => {
    const plan = planBuyGas(101n * DOLLAR, 100n * DOLLAR);
    expect(plan).toEqual({
      action: "hypefuel",
      proposedBuyUsdcWei: 100n * DOLLAR,
      haircut: false,
    });
  });

  it("haircuts a MAX buy that fits but has no spare $1", () => {
    const plan = planBuyGas(100n * DOLLAR, 100n * DOLLAR);
    expect(plan.action).toBe("hypefuel");
    expect(plan.haircut).toBe(true);
    expect(plan.proposedBuyUsdcWei).toBe(99n * DOLLAR);
  });

  it("haircuts down to exactly the $20 min buy", () => {
    const plan = planBuyGas(21n * DOLLAR, 21n * DOLLAR);
    expect(plan.action).toBe("hypefuel");
    expect(plan.haircut).toBe(true);
    expect(plan.proposedBuyUsdcWei).toBe(20n * DOLLAR);
  });

  it("relays when a haircut would land under the $20 min buy", () => {
    const plan = planBuyGas(20n * DOLLAR, 20n * DOLLAR);
    expect(plan.action).toBe("relay");
    expect(plan.haircut).toBe(false);
    expect(plan.proposedBuyUsdcWei).toBe(20n * DOLLAR);
  });

  it("leaves an underfunded buy to the existing USDC error", () => {
    expect(planBuyGas(500_000n, 20n * DOLLAR).action).toBe("none");
    expect(planBuyGas(HYPEFUEL_USDC_WEI - 1n, 20n * DOLLAR).action).toBe("none");
  });

  it("relays when leftover after $1 would sit under the min buy", () => {
    const plan = planBuyGas(20n * DOLLAR + 500_000n, 20n * DOLLAR);
    expect(plan.action).toBe("relay");
    expect(plan.haircut).toBe(false);
  });
});

describe("planSellGas", () => {
  it("hypefuels a typed sell when USDC covers $1", () => {
    expect(planSellGas(5n * DOLLAR, true)).toBe("hypefuel");
    expect(planSellGas(HYPEFUEL_USDC_WEI - 1n, true)).toBe("relay");
    expect(planSellGas(100n * DOLLAR, false)).toBe("none");
  });
});

describe("canHypeFuelFromUsdc", () => {
  it("requires the $1 floor", () => {
    expect(canHypeFuelFromUsdc(HYPEFUEL_USDC_WEI)).toBe(true);
    expect(canHypeFuelFromUsdc(HYPEFUEL_USDC_WEI - 1n)).toBe(false);
  });
});

describe("needsGas", () => {
  const threshold = parseUnits("0.005", 18);

  it("is false until the balance has loaded", () => {
    expect(needsGas(null, false)).toBe(false);
  });

  it("is true only below the threshold and without a latch", () => {
    expect(needsGas(threshold - 1n, false)).toBe(true);
    expect(needsGas(threshold, false)).toBe(false);
    expect(needsGas(0n, true)).toBe(false);
  });
});
