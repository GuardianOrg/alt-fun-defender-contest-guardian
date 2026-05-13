/**
 * On-chain withdraw primitives. Mirrors the buy/sell shape in
 * `lib/trade.ts` so the command handler can stay focused on Telegram
 * UX while this module owns calldata construction, gas estimation, and
 * tx submission. Native HYPE goes out as a plain value transfer; ERC-20
 * USDC goes out via the standard `transfer(to, amount)` calldata.
 *
 * Failure shape matches `ExecutionResult` from `lib/trade.ts` so
 * callers can share `renderExecutionError`.
 */

import { HYPER_EVM, USDC_ADDRESS } from "@launchpad/shared";
import {
  BaseError,
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  parseAbi,
  type Address,
  type Hash,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import type { Env } from "./types.js";

const SIMULATION_TIMEOUT_MS = 5000;
const GAS_LIMIT_CAP = 1_000_000n;
const GAS_BUFFER_NUM = 13n;
const GAS_BUFFER_DEN = 10n;

const viemChain = {
  id: HYPER_EVM.id,
  name: HYPER_EVM.name,
  nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
  rpcUrls: { default: { http: [HYPER_EVM.rpcUrl] } },
} as const;

const ERC20_ABI = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)",
]);

export type Hex = `0x${string}`;
export type WithdrawAsset = "HYPE" | "USDC";

/** Decimals for each supported asset. USDC is 6dp on HyperEVM; HYPE native is 18dp. */
export const ASSET_DECIMALS: Record<WithdrawAsset, number> = {
  HYPE: 18,
  USDC: 6,
};

export type WithdrawResult =
  | { ok: true; txHash: Hash }
  | {
      ok: false;
      kind: "not_configured" | "reverted" | "unavailable" | "insufficient_funds";
      reason?: string;
    };

export interface ExecuteWithdrawArgs {
  asset: WithdrawAsset;
  /** Destination address (already validated by the caller). */
  to: Hex;
  /** Raw amount (asset decimals applied). */
  amountRaw: bigint;
  /** Sender EOA. */
  from: Hex;
  /** Sender EOA private key — signs the tx. Never logged. */
  privateKey: Hex;
}

const bufferGas = (estimated: bigint): bigint => {
  const buffered = (estimated * GAS_BUFFER_NUM) / GAS_BUFFER_DEN;
  return buffered > GAS_LIMIT_CAP ? GAS_LIMIT_CAP : buffered;
};

/**
 * Parse a user-entered decimal amount into a raw bigint using the
 * asset's decimals. Returns `null` for any malformed input so the
 * caller can surface a clean validation error instead of catching a
 * thrown exception. Rejects negative numbers and amounts beyond the
 * declared decimals (e.g. `0.1234567` USDC) since both indicate the
 * user mistyped rather than legitimately wanting sub-decimal precision.
 */
export const parseAmount = (
  input: string,
  asset: WithdrawAsset,
): bigint | null => {
  const trimmed = input.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const decimals = ASSET_DECIMALS[asset];
  const [whole, frac = ""] = trimmed.split(".");
  if (frac.length > decimals) return null;
  const padded = frac.padEnd(decimals, "0");
  const raw = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(padded || "0");
  if (raw === 0n) return null;
  return raw;
};

/** Format a raw amount back to a fixed-decimal display string. */
export const formatAmount = (raw: bigint, asset: WithdrawAsset): string => {
  const decimals = ASSET_DECIMALS[asset];
  const base = 10n ** BigInt(decimals);
  const whole = raw / base;
  const frac = raw % base;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole.toString()}.${fracStr}`;
};

const HEX_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * Validate that the destination is a well-formed EVM address. Returns
 * the lowercased canonical form so log + receipt rendering is
 * consistent. Mirrors `loadReferrer`'s validation rather than reaching
 * for viem's `isAddress`, which also accepts EIP-55 mixed-case and
 * would complicate the equality checks in tests.
 */
export const parseDestination = (input: string): Hex | null => {
  const trimmed = input.trim();
  if (!HEX_ADDRESS_RE.test(trimmed)) return null;
  return trimmed.toLowerCase() as Hex;
};

/**
 * Submit the withdraw tx. Native HYPE goes out as a value transfer with
 * empty calldata; USDC goes out as an ERC-20 `transfer(to, amount)`.
 *
 * Returns a typed failure when the RPC is unreachable or the tx
 * reverts (e.g. insufficient balance) so the caller can render a
 * user-facing message instead of leaking viem's wrapper.
 */
export const executeWithdraw = async (
  env: Pick<Env, "HYPEREVM_RPC_URL">,
  args: ExecuteWithdrawArgs,
): Promise<WithdrawResult> => {
  const url = env.HYPEREVM_RPC_URL ?? HYPER_EVM.rpcUrl;
  const publicClient = createPublicClient({
    chain: viemChain,
    transport: http(url, { timeout: SIMULATION_TIMEOUT_MS }),
  });
  const account = privateKeyToAccount(args.privateKey);
  const walletClient = createWalletClient({
    account,
    chain: viemChain,
    transport: http(url, { timeout: SIMULATION_TIMEOUT_MS }),
  });

  try {
    if (args.asset === "HYPE") {
      const estimated = await publicClient.estimateGas({
        account: args.from,
        to: args.to,
        value: args.amountRaw,
      });
      const txHash = await walletClient.sendTransaction({
        account,
        chain: viemChain,
        to: args.to,
        value: args.amountRaw,
        gas: bufferGas(estimated),
      });
      return { ok: true, txHash };
    }
    const data = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: "transfer",
      args: [args.to, args.amountRaw],
    });
    const estimated = await publicClient.estimateGas({
      account: args.from,
      to: USDC_ADDRESS as Address,
      data,
    });
    const txHash = await walletClient.sendTransaction({
      account,
      chain: viemChain,
      to: USDC_ADDRESS as Address,
      data,
      gas: bufferGas(estimated),
    });
    return { ok: true, txHash };
  } catch (err) {
    if (err instanceof BaseError) {
      const message = err.shortMessage ?? err.message;
      if (/insufficient funds/i.test(message)) {
        return { ok: false, kind: "insufficient_funds", reason: message };
      }
      if (/revert|execution reverted/i.test(message)) {
        return { ok: false, kind: "reverted", reason: message };
      }
      return { ok: false, kind: "unavailable", reason: message };
    }
    return {
      ok: false,
      kind: "unavailable",
      reason: err instanceof Error ? err.message : String(err),
    };
  }
};

export const isWithdrawAsset = (s: string): s is WithdrawAsset =>
  s === "HYPE" || s === "USDC";
