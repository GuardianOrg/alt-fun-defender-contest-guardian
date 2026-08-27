import { MIN_USDC_BUY_AMOUNT, USDC_ADDRESS } from "@launchpad/shared";
import { encodeAbiParameters, keccak256, parseUnits, toHex } from "viem";

import { USDC_DECIMALS } from "../contracts/addresses";

export const HYPEFUEL_API = "https://api.hypefuel.me";
export const HYPEFUEL_DOCS_URL = "https://hypefuel.me/docs";
export const HYPEFUEL_SITE_URL = "https://hypefuel.me";
export const HYPEFUEL_ADDRESS =
  "0x42b06b1d9a07Fc3925C518dbf9475E7cA80DC8DF" as const;

/** Contract minimum fill size. Quote `$1` rather than polling `/v1/config`. */
export const HYPEFUEL_USDC_WEI = 1_000_000n;

/** Native HYPE below this cannot reliably pay a Zap buy/sell. */
export const LOW_HYPE_THRESHOLD_WEI = parseUnits("0.005", 18);

const HYPEFUEL_FETCH_TIMEOUT_MS = 15_000;
const HYPER_EVM_CHAIN_ID = 999;

const MIN_BUY_USDC_WEI = parseUnits(String(MIN_USDC_BUY_AMOUNT), USDC_DECIMALS);

const ORDER_TYPEHASH = keccak256(
  toHex(
    "HypeFuelOrder(address user,uint256 usdcIn,uint256 minHypeOut,uint256 validAfter,uint256 validBefore,bytes32 salt)",
  ),
);

export class HypeFuelError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "HypeFuelError";
    this.code = code;
  }
}

export interface HypeFuelSerializedOrder {
  user: `0x${string}`;
  usdcIn: string;
  minHypeOut: string;
  validAfter: string;
  validBefore: string;
  salt: `0x${string}`;
}

export interface HypeFuelQuotePreview {
  usdcInFormatted: string;
  feeUsdcFormatted: string;
  hypeOutFormatted: string;
  expiresAt: number;
}

export interface HypeFuelQuoteResponse {
  order: HypeFuelSerializedOrder;
  quote: HypeFuelQuotePreview;
  typedData: HypeFuelTypedDataJson;
}

export interface HypeFuelTypedDataJson {
  domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: `0x${string}`;
  };
  types: Record<string, { name: string; type: string }[]>;
  primaryType: string;
  message: {
    from: `0x${string}`;
    to: `0x${string}`;
    value: string;
    validAfter: string;
    validBefore: string;
    nonce: `0x${string}`;
  };
}

export interface HypeFuelFillResponse {
  transactionHash: `0x${string}`;
}

export type GasAction = "none" | "hypefuel" | "relay";

export interface BuyGasPlan {
  action: GasAction;
  proposedBuyUsdcWei: bigint;
  haircut: boolean;
}

interface ErrorBody {
  error?: { code?: unknown; message?: unknown };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseHypeFuelError(status: number, body: unknown): HypeFuelError {
  if (isRecord(body)) {
    const wrapped = body as ErrorBody;
    const code =
      typeof wrapped.error?.code === "string" && wrapped.error.code.length > 0
        ? wrapped.error.code
        : "http_error";
    const message =
      typeof wrapped.error?.message === "string" && wrapped.error.message.length > 0
        ? wrapped.error.message
        : `HypeFuel request failed (${status})`;
    return new HypeFuelError(code, message);
  }
  return new HypeFuelError("http_error", `HypeFuel request failed (${status})`);
}

/** Codes where the user should fall back to bridging HYPE instead of retrying. */
export function isHypeFuelRelayFallback(code: string): boolean {
  return (
    code === "insufficient_liquidity" ||
    code === "oracle_deviation" ||
    code === "paused" ||
    code === "order_size" ||
    code === "rate_limited"
  );
}

async function hypeFuelFetch<T>(path: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${HYPEFUEL_API}${path}`, {
      ...init,
      signal: AbortSignal.timeout(HYPEFUEL_FETCH_TIMEOUT_MS),
    });
  } catch (e) {
    if (e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError")) {
      throw new HypeFuelError("timeout", "HypeFuel timed out. Try again or bridge HYPE.");
    }
    throw e;
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    throw parseHypeFuelError(res.status, body);
  }
  return body as T;
}

export async function quoteHypeFuel(
  user: `0x${string}`,
  usdcIn: bigint = HYPEFUEL_USDC_WEI,
): Promise<HypeFuelQuoteResponse> {
  return hypeFuelFetch<HypeFuelQuoteResponse>("/v1/quote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user, usdcIn: usdcIn.toString() }),
  });
}

export async function fillHypeFuel(
  order: HypeFuelSerializedOrder,
  signature: `0x${string}`,
): Promise<HypeFuelFillResponse> {
  return hypeFuelFetch<HypeFuelFillResponse>("/v1/fill", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ order, signature }),
  });
}

/**
 * viem's `signTypedData` wants bigint uint256 fields and rejects an
 * `EIP712Domain` entry in `types` (it injects that itself). The relayer
 * JSON uses strings and may include the extra type for wallet RPC clients.
 */
export function typedDataForViem(raw: HypeFuelTypedDataJson) {
  return {
    domain: {
      name: raw.domain.name,
      version: raw.domain.version,
      chainId: Number(raw.domain.chainId),
      verifyingContract: raw.domain.verifyingContract,
    },
    types: {
      ReceiveWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "ReceiveWithAuthorization" as const,
    message: {
      from: raw.message.from,
      to: raw.message.to,
      value: BigInt(raw.message.value),
      validAfter: BigInt(raw.message.validAfter),
      validBefore: BigInt(raw.message.validBefore),
      nonce: raw.message.nonce,
    },
  };
}

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function orderNonce(order: HypeFuelSerializedOrder): `0x${string}` {
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
        ORDER_TYPEHASH,
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

/** Reject a quote whose EIP-3009 payload does not match the `$1` top-up we displayed. */
export function assertHypeFuelAuthorization(
  user: `0x${string}`,
  order: HypeFuelSerializedOrder,
  raw: HypeFuelTypedDataJson,
) {
  const typed = typedDataForViem(raw);
  if (typed.domain.chainId !== HYPER_EVM_CHAIN_ID) {
    throw new HypeFuelError("invalid_quote", "HypeFuel quote is for the wrong chain.");
  }
  if (!sameAddress(typed.domain.verifyingContract, USDC_ADDRESS)) {
    throw new HypeFuelError("invalid_quote", "HypeFuel quote is not for USDC.");
  }
  if (!sameAddress(typed.message.from, user) || !sameAddress(order.user, user)) {
    throw new HypeFuelError("invalid_quote", "HypeFuel quote is for a different wallet.");
  }
  if (!sameAddress(typed.message.to, HYPEFUEL_ADDRESS)) {
    throw new HypeFuelError("invalid_quote", "HypeFuel quote pays the wrong contract.");
  }
  if (typed.message.value !== HYPEFUEL_USDC_WEI || order.usdcIn !== HYPEFUEL_USDC_WEI.toString()) {
    throw new HypeFuelError("invalid_quote", "HypeFuel quote amount does not match $1.");
  }
  if (typed.message.nonce.toLowerCase() !== orderNonce(order).toLowerCase()) {
    throw new HypeFuelError("invalid_quote", "HypeFuel quote nonce does not match the order.");
  }
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (typed.message.validAfter > now) {
    throw new HypeFuelError("invalid_quote", "HypeFuel quote is not yet valid.");
  }
  if (typed.message.validBefore <= now) {
    throw new HypeFuelError("order_expired", "HypeFuel quote expired. Try again.");
  }
  return typed;
}

export function parseTypedUsdcWei(amount: string): bigint {
  if (!amount) return 0n;
  try {
    return parseUnits(amount, USDC_DECIMALS);
  } catch {
    return 0n;
  }
}

export function needsGas(hypeWei: bigint | null): boolean {
  if (hypeWei === null) return false;
  return hypeWei < LOW_HYPE_THRESHOLD_WEI;
}

/**
 * What to do for a buy when `needsGas` is already true. Haircut only when
 * the typed buy already fits the USDC balance; never rewrite an underfunded
 * buy into a smaller one.
 */
export function planBuyGas(usdcWei: bigint, typedBuyUsdcWei: bigint): BuyGasPlan {
  if (typedBuyUsdcWei === 0n) {
    return { action: "none", proposedBuyUsdcWei: 0n, haircut: false };
  }
  if (typedBuyUsdcWei > usdcWei) {
    return { action: "none", proposedBuyUsdcWei: typedBuyUsdcWei, haircut: false };
  }
  if (usdcWei < HYPEFUEL_USDC_WEI) {
    return { action: "relay", proposedBuyUsdcWei: typedBuyUsdcWei, haircut: false };
  }
  if (typedBuyUsdcWei + HYPEFUEL_USDC_WEI <= usdcWei) {
    return {
      action: "hypefuel",
      proposedBuyUsdcWei: typedBuyUsdcWei,
      haircut: false,
    };
  }
  const proposedBuyUsdcWei = usdcWei - HYPEFUEL_USDC_WEI;
  if (proposedBuyUsdcWei >= MIN_BUY_USDC_WEI) {
    return { action: "hypefuel", proposedBuyUsdcWei, haircut: true };
  }
  return { action: "relay", proposedBuyUsdcWei: typedBuyUsdcWei, haircut: false };
}

export function planSellGas(usdcWei: bigint, hasTypedAmount: boolean): GasAction {
  if (!hasTypedAmount) return "none";
  return usdcWei >= HYPEFUEL_USDC_WEI ? "hypefuel" : "relay";
}

export function canHypeFuelFromUsdc(usdcWei: bigint): boolean {
  return usdcWei >= HYPEFUEL_USDC_WEI;
}
