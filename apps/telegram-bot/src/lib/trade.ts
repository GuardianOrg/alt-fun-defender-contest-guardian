/**
 * Trade execution infra (issue #686).
 *
 * Wraps viem's `simulateContract` for the `BotFeeRouter` so the sell flow
 * can derive `quotedUsdcOut` from a real on-chain call instead of the
 * `priceUsd × balance × (1 − COMBINED_FEE_RATE)` heuristic that #683
 * shipped as a stub. The same primitives will back the buy flow and the
 * eventual tx-submission path (gas estimate → sign → send), so the
 * surface here is deliberately wider than what /sell needs today.
 *
 * Failure modes return typed errors rather than throwing — callers want
 * to distinguish "router not configured yet" (fall back to legacy
 * heuristic) from "simulation reverted" (surface a user-facing error)
 * from "RPC unreachable" (transient, retry).
 */

import {
  BotFeeRouterAbi,
  HYPER_EVM,
} from "@launchpad/shared";
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  http,
  type Address,
  type PublicClient,
} from "viem";

import type { Env } from "./types.js";

/** Viem `Chain` for HyperEVM — minimal shape needed for `createPublicClient`. */
const chain = {
  id: HYPER_EVM.id,
  name: HYPER_EVM.name,
  nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
  rpcUrls: { default: { http: [HYPER_EVM.rpcUrl] } },
} as const;

/**
 * Cap on a single `simulateContract` request. The webhook handler must
 * ACK Telegram inside a few seconds or the platform retries; a stalled
 * RPC has to surface as `unavailable` rather than block the whole
 * update. 5s is generous for an `eth_call` and well below the webhook
 * timeout.
 */
const SIMULATION_TIMEOUT_MS = 5000;

export type Hex = `0x${string}`;
const ZERO_ADDRESS: Hex = "0x0000000000000000000000000000000000000000";

export interface SellSimulationArgs {
  /** Token being sold (ERC-20). */
  token: Hex;
  /** Token amount, 18-dp raw. */
  tokenAmount: bigint;
  /** Trader EOA — used as `account` for the simulated tx. */
  trader: Hex;
  /** Referrer (zero address if user has no recorded referrer). */
  referrer?: Hex;
}

export type SellSimulationResult =
  | { ok: true; quotedUsdcOut: bigint }
  | { ok: false; kind: "not_configured" | "reverted" | "unavailable"; reason?: string };

/**
 * Build a viem `PublicClient` against HyperEVM. Falls back to the public
 * Hyperliquid RPC if `HYPEREVM_RPC_URL` is unset, matching `lib/rpc.ts`
 * so smoke deploys / local dev keep working without Alchemy provisioning.
 */
export const buildPublicClient = (
  env: Pick<Env, "HYPEREVM_RPC_URL">,
): PublicClient => {
  const url = env.HYPEREVM_RPC_URL ?? HYPER_EVM.rpcUrl;
  return createPublicClient({
    chain,
    transport: http(url, { timeout: SIMULATION_TIMEOUT_MS }),
  }) as PublicClient;
};

/**
 * Address parsing helper. Coerces a `string` to viem's branded `Hex`
 * type and lower-cases for consistent log/error rendering. Callers are
 * responsible for upstream validation (the bot only sees addresses that
 * have already passed `lib/api.ts → isAddress`).
 */
const asHex = (s: string): Hex => s as Hex;

/**
 * Simulate `BotFeeRouter.sellWithBotFee` with `minUsdcOut = 0` to obtain
 * the post-bot-fee USDC amount the user would actually receive. The
 * caller derives the real-tx `minUsdcOut` bound from this quote via
 * `computeMinUsdcOut`.
 *
 * The simulation is `eth_call`-based (no state mutation, no gas spend).
 * If the user has not yet approved `BotFeeRouter` to spend their tokens,
 * the call reverts inside `transferFrom`; the eventual sell-tx path
 * handles the approve/permit step separately. For now that case surfaces
 * as `{ ok: false, kind: "reverted" }` and the caller falls back to the
 * legacy heuristic.
 *
 * Returns `{ ok: false, kind: "not_configured" }` when the
 * `BOT_FEE_ROUTER_ADDRESS` env var is unset — production will set it
 * once the router contract is deployed by the bot team. Until then the
 * sell flow degrades gracefully to the priceUsd estimate.
 */
export const simulateSellWithBotFee = async (
  env: Pick<Env, "HYPEREVM_RPC_URL" | "BOT_FEE_ROUTER_ADDRESS">,
  args: SellSimulationArgs,
): Promise<SellSimulationResult> => {
  const routerAddr = env.BOT_FEE_ROUTER_ADDRESS?.trim();
  if (!routerAddr) {
    return { ok: false, kind: "not_configured" };
  }

  const client = buildPublicClient(env);
  try {
    const { result } = await client.simulateContract({
      address: asHex(routerAddr) as Address,
      abi: BotFeeRouterAbi,
      functionName: "sellWithBotFee",
      args: [
        args.token,
        args.tokenAmount,
        0n,
        args.referrer ?? ZERO_ADDRESS,
      ],
      account: args.trader,
    });
    // `sellWithBotFee` returns `usdcOut` — the post-bot-fee net the user
    // receives, per the router spec in apps/telegram-bot/AGENTS.md.
    return { ok: true, quotedUsdcOut: result };
  } catch (err) {
    if (err instanceof BaseError) {
      const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError);
      if (reverted instanceof ContractFunctionRevertedError) {
        return {
          ok: false,
          kind: "reverted",
          reason: reverted.shortMessage,
        };
      }
    }
    return {
      ok: false,
      kind: "unavailable",
      reason: err instanceof Error ? err.message : String(err),
    };
  }
};

/**
 * Compute the `minUsdcOut` bound for the real sell tx from a simulation
 * quote. Mirrors `useTradeRouter.executeSell` in apps/web — never submit
 * with `minUsdcOut = 0` from a live signer (fully sandwichable). When
 * `quotedUsdcOut > 0` and slippage rounding would land the bound at 0,
 * we floor at 1 wei per the AGENTS.md sell spec.
 */
export const computeMinUsdcOut = (
  quotedUsdcOut: bigint,
  slippageBps: number,
): bigint => {
  if (quotedUsdcOut === 0n) return 0n;
  if (slippageBps < 0 || slippageBps > 10_000) {
    throw new RangeError(
      `slippageBps must be in [0, 10000], got ${slippageBps}`,
    );
  }
  const bound = (quotedUsdcOut * BigInt(10_000 - slippageBps)) / 10_000n;
  return bound === 0n ? 1n : bound;
};

/** Format a 6-dp USDC raw value as a plain number ($X.XX precision). */
export const usdcRawToNumber = (raw: bigint): number =>
  Number(raw) / 1_000_000;
