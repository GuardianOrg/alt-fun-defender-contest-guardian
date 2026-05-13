import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts";

import {
  ASSET_DECIMALS,
  executeWithdraw,
  formatAmount,
  isWithdrawAsset,
  parseAmount,
  parseDestination,
  type Hex,
} from "../../lib/withdraw.js";

const RPC_URL = "https://rpc.test.local";
const TO = "0x2222222222222222222222222222222222222222" as Hex;

describe("parseAmount", () => {
  it("parses an integer USDC amount into 6dp raw", () => {
    expect(parseAmount("25", "USDC")).toBe(25_000_000n);
  });

  it("parses a fractional HYPE amount into 18dp raw", () => {
    expect(parseAmount("0.1", "HYPE")).toBe(10n ** 17n);
  });

  it("rejects more fractional digits than the asset has decimals", () => {
    expect(parseAmount("0.1234567", "USDC")).toBeNull();
  });

  it("rejects negative or non-numeric input", () => {
    expect(parseAmount("-1", "USDC")).toBeNull();
    expect(parseAmount("abc", "USDC")).toBeNull();
    expect(parseAmount("", "USDC")).toBeNull();
  });

  it("rejects zero (a zero-amount withdraw is never meaningful)", () => {
    expect(parseAmount("0", "USDC")).toBeNull();
    expect(parseAmount("0.0", "HYPE")).toBeNull();
  });
});

describe("formatAmount", () => {
  it("round-trips a fractional USDC amount", () => {
    const raw = parseAmount("12.34", "USDC")!;
    expect(formatAmount(raw, "USDC")).toBe("12.34");
  });

  it("renders a whole HYPE amount without trailing zeroes", () => {
    expect(formatAmount(5n * 10n ** 18n, "HYPE")).toBe("5");
  });
});

describe("parseDestination", () => {
  it("accepts a valid 0x address and lowercases it", () => {
    expect(parseDestination("0xABCDEFabcdef0123456789ABCDEF0123456789AB")).toBe(
      "0xabcdefabcdef0123456789abcdef0123456789ab",
    );
  });

  it("rejects missing 0x prefix, wrong length, or non-hex chars", () => {
    expect(parseDestination("abcdef")).toBeNull();
    expect(parseDestination("0xZZZZ")).toBeNull();
    expect(parseDestination("0xabc")).toBeNull();
  });
});

describe("isWithdrawAsset", () => {
  it("accepts HYPE and USDC, rejects anything else", () => {
    expect(isWithdrawAsset("HYPE")).toBe(true);
    expect(isWithdrawAsset("USDC")).toBe(true);
    expect(isWithdrawAsset("ETH")).toBe(false);
    expect(isWithdrawAsset("hype")).toBe(false);
  });
});

describe("ASSET_DECIMALS", () => {
  it("uses 18dp for HYPE and 6dp for USDC", () => {
    expect(ASSET_DECIMALS.HYPE).toBe(18);
    expect(ASSET_DECIMALS.USDC).toBe(6);
  });
});

interface RpcCall {
  method: string;
  params: unknown;
}

/** Build a fetch mock that walks viem's JSON-RPC calls through a script. */
const scriptedRpc = (
  fetchSpy: ReturnType<typeof vi.spyOn>,
  handlers: Record<string, (params: unknown) => unknown>,
  calls: RpcCall[],
): void => {
  fetchSpy.mockImplementation(async (_url: unknown, init?: unknown) => {
    const body = JSON.parse((init as RequestInit).body as string) as {
      method: string;
      params: unknown;
    };
    calls.push({ method: body.method, params: body.params });
    const handler = handlers[body.method];
    if (!handler) {
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          error: { code: -32601, message: `unhandled ${body.method}` },
        }),
        { status: 200 },
      );
    }
    const result = handler(body.params);
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", id: 1, result }),
      { status: 200 },
    );
  });
};

describe("executeWithdraw", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("submits a HYPE transfer as a value tx to the destination", async () => {
    const calls: RpcCall[] = [];
    const txHash =
      "0x1111111111111111111111111111111111111111111111111111111111111111";
    scriptedRpc(fetchSpy, {
      eth_chainId: () => "0x3e7",
      eth_getTransactionCount: () => "0x0",
      eth_gasPrice: () => "0x1",
      eth_maxPriorityFeePerGas: () => "0x1",
      eth_feeHistory: () => ({
        oldestBlock: "0x0",
        baseFeePerGas: ["0x1", "0x1"],
        gasUsedRatio: [0],
        reward: [["0x1"]],
      }),
      eth_getBlockByNumber: () => ({
        baseFeePerGas: "0x1",
        number: "0x1",
        timestamp: "0x1",
      }),
      eth_estimateGas: () => "0x5208",
      eth_sendRawTransaction: () => txHash,
    }, calls);

    const pk = generatePrivateKey();
    const from = privateKeyToAddress(pk);
    const result = await executeWithdraw(
      { HYPEREVM_RPC_URL: RPC_URL },
      {
        asset: "HYPE",
        to: TO,
        amountRaw: 10n ** 17n,
        from: from as Hex,
        privateKey: pk,
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.txHash).toBe(txHash);

    // The estimate must target the destination address with the correct
    // value and empty data; that is how the bot proves the user-entered
    // address and amount round-trip into the signed tx.
    const estimate = calls.find((c) => c.method === "eth_estimateGas");
    expect(estimate).toBeDefined();
    const estimateParam = (estimate!.params as Array<Record<string, string>>)[0];
    expect(estimateParam.to.toLowerCase()).toBe(TO.toLowerCase());
    expect(BigInt(estimateParam.value ?? "0x0")).toBe(10n ** 17n);

    // The signed payload was forwarded to the RPC — that is the
    // AGENTS.md "Valid flow → eth_sendRawTransaction called" check.
    expect(calls.some((c) => c.method === "eth_sendRawTransaction")).toBe(true);
  });

  it("submits a USDC transfer as an ERC-20 calldata tx to the USDC contract", async () => {
    const calls: RpcCall[] = [];
    const txHash =
      "0x2222222222222222222222222222222222222222222222222222222222222222";
    scriptedRpc(fetchSpy, {
      eth_chainId: () => "0x3e7",
      eth_getTransactionCount: () => "0x0",
      eth_gasPrice: () => "0x1",
      eth_maxPriorityFeePerGas: () => "0x1",
      eth_feeHistory: () => ({
        oldestBlock: "0x0",
        baseFeePerGas: ["0x1", "0x1"],
        gasUsedRatio: [0],
        reward: [["0x1"]],
      }),
      eth_getBlockByNumber: () => ({
        baseFeePerGas: "0x1",
        number: "0x1",
        timestamp: "0x1",
      }),
      eth_estimateGas: () => "0x5208",
      eth_sendRawTransaction: () => txHash,
    }, calls);

    const pk = generatePrivateKey();
    const from = privateKeyToAddress(pk);
    const result = await executeWithdraw(
      { HYPEREVM_RPC_URL: RPC_URL },
      {
        asset: "USDC",
        to: TO,
        amountRaw: 25_000_000n,
        from: from as Hex,
        privateKey: pk,
      },
    );

    expect(result.ok).toBe(true);
    const estimate = calls.find((c) => c.method === "eth_estimateGas");
    expect(estimate).toBeDefined();
    const estimateParam = (estimate!.params as Array<Record<string, string>>)[0];
    // USDC tx targets the token contract, not the destination directly.
    expect(estimateParam.to.toLowerCase()).toBe(
      "0xb88339cb7199b77e23db6e890353e22632ba630f",
    );
    // Calldata starts with `transfer(address,uint256)` selector.
    expect(estimateParam.data?.startsWith("0xa9059cbb")).toBe(true);
  });
});
