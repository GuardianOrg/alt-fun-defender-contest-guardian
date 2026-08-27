import { USDC_ADDRESS } from "@launchpad/shared";
import { encodeAbiParameters, keccak256, parseUnits, toHex } from "viem";
import { describe, expect, it } from "vitest";

import {
  HYPEFUEL_ADDRESS,
  HYPEFUEL_USDC_WEI,
  assertHypeFuelAuthorization,
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
    expect(needsGas(null)).toBe(false);
  });

  it("is true only below the threshold", () => {
    expect(needsGas(threshold - 1n)).toBe(true);
    expect(needsGas(threshold)).toBe(false);
    expect(needsGas(0n)).toBe(true);
  });
});

const USER = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" as const;
const SALT =
  "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const;

function quoteNonce(order: {
  user: `0x${string}`;
  usdcIn: string;
  minHypeOut: string;
  validAfter: string;
  validBefore: string;
  salt: `0x${string}`;
}): `0x${string}` {
  const typehash = keccak256(
    toHex(
      "HypeFuelOrder(address user,uint256 usdcIn,uint256 minHypeOut,uint256 validAfter,uint256 validBefore,bytes32 salt)",
    ),
  );
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "address" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "bytes32" },
      ],
      [
        typehash,
        order.user,
        BigInt(order.usdcIn),
        BigInt(order.minHypeOut),
        BigInt(order.validAfter),
        BigInt(order.validBefore),
        order.salt,
      ],
    ),
  );
}

describe("assertHypeFuelAuthorization", () => {
  const validBefore = String(Math.floor(Date.now() / 1000) + 300);
  const order = {
    user: USER,
    usdcIn: HYPEFUEL_USDC_WEI.toString(),
    minHypeOut: "1",
    validAfter: "0",
    validBefore,
    salt: SALT,
  };

  function typed(overrides?: {
    to?: `0x${string}`;
    value?: string;
    nonce?: `0x${string}`;
  }) {
    return {
      domain: {
        name: "USDC",
        version: "2",
        chainId: 999,
        verifyingContract: USDC_ADDRESS,
      },
      types: {
        ReceiveWithAuthorization: [{ name: "from", type: "address" }],
      },
      primaryType: "ReceiveWithAuthorization",
      message: {
        from: USER,
        to: overrides?.to ?? HYPEFUEL_ADDRESS,
        value: overrides?.value ?? HYPEFUEL_USDC_WEI.toString(),
        validAfter: "0",
        validBefore,
        nonce: overrides?.nonce ?? quoteNonce(order),
      },
    };
  }

  it("accepts a $1 quote bound to the signer and HypeFuel", () => {
    expect(() => assertHypeFuelAuthorization(USER, order, typed())).not.toThrow();
  });

  it("rejects a quote that pays a different contract", () => {
    expect(() =>
      assertHypeFuelAuthorization(USER, order, typed({ to: USER })),
    ).toThrow(/wrong contract/);
  });

  it("rejects a quote that spends more than $1", () => {
    expect(() =>
      assertHypeFuelAuthorization(USER, order, typed({ value: "2000000" })),
    ).toThrow(/\$1/);
  });

  it("rejects a quote that is not yet valid", () => {
    const validAfter = String(Math.floor(Date.now() / 1000) + 60);
    const future = { ...order, validAfter };
    const payload = typed();
    payload.message.validAfter = validAfter;
    payload.message.nonce = quoteNonce(future);
    expect(() => assertHypeFuelAuthorization(USER, future, payload)).toThrow(
      /not yet valid/,
    );
  });
});
