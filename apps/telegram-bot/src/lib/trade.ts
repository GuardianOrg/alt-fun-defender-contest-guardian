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
  USDC_ADDRESS,
} from "@launchpad/shared";
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  parseAbi,
  type Address,
  type Hash,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

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

/**
 * Cap on waiting for a buy/sell tx to mine before we report status. The
 * CF Worker invocation has ~30s of wall time; 20s leaves headroom for
 * sim + approve + submit + reply rendering. If the receipt isn't seen in
 * this window the result is `unavailable` (with the txHash echoed back
 * so the user can inspect the explorer manually) — we must never claim
 * success without an actual on-chain confirmation, since a reverted tx
 * still returns a hash from `sendTransaction` and an early "✅ submitted"
 * misleads users into thinking their trade landed.
 */
const RECEIPT_TIMEOUT_MS = 20_000;

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

export interface BuySimulationArgs {
  /** Token being bought (ERC-20). */
  token: Hex;
  /** Gross USDC notional, 6-dp raw. Router skims bot fee before forwarding. */
  usdcAmount: bigint;
  /** Trader EOA — used as `account` for the simulated tx. */
  trader: Hex;
  /** Referrer (zero address if user has no recorded referrer). */
  referrer?: Hex;
}

export type BuySimulationResult =
  | { ok: true; quotedTokensOut: bigint }
  | { ok: false; kind: "not_configured" | "reverted" | "unavailable"; reason?: string };

/**
 * Simulate `BotFeeRouter.buyWithBotFee` with `minTokensOut = 0` to obtain
 * the post-bot-fee token amount the user would receive. The caller
 * derives the real-tx `minTokensOut` bound from this quote via
 * `computeMinTokensOut`. Mirrors `simulateSellWithBotFee` — same
 * not_configured / reverted / unavailable taxonomy.
 */
export const simulateBuyWithBotFee = async (
  env: Pick<Env, "HYPEREVM_RPC_URL" | "BOT_FEE_ROUTER_ADDRESS">,
  args: BuySimulationArgs,
): Promise<BuySimulationResult> => {
  const routerAddr = env.BOT_FEE_ROUTER_ADDRESS?.trim();
  if (!routerAddr) {
    return { ok: false, kind: "not_configured" };
  }

  const client = buildPublicClient(env);
  try {
    const { result } = await client.simulateContract({
      address: asHex(routerAddr) as Address,
      abi: BotFeeRouterAbi,
      functionName: "buyWithBotFee",
      args: [
        args.token,
        args.usdcAmount,
        0n,
        args.referrer ?? ZERO_ADDRESS,
      ],
      account: args.trader,
    });
    return { ok: true, quotedTokensOut: result };
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
 * Mirror of `computeMinUsdcOut` for the buy side. Returns 0 when the
 * quote is 0, floors at 1 wei when slippage rounding would otherwise
 * land on 0 against a positive quote — same anti-sandwich rule.
 */
export const computeMinTokensOut = (
  quotedTokensOut: bigint,
  slippageBps: number,
): bigint => {
  if (quotedTokensOut === 0n) return 0n;
  if (slippageBps < 0 || slippageBps > 10_000) {
    throw new RangeError(
      `slippageBps must be in [0, 10000], got ${slippageBps}`,
    );
  }
  const bound = (quotedTokensOut * BigInt(10_000 - slippageBps)) / 10_000n;
  return bound === 0n ? 1n : bound;
};

/**
 * Minimal ERC-20 surface — `allowance` (read) + `approve` (write) for the
 * pre-trade approval step. Full ABI lives in `lib/rpc.ts` for balance
 * reads; the parsing here is cheap enough to keep local.
 */
const ERC20_ABI = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

const MAX_UINT256 = (1n << 256n) - 1n;

/** Maximum gas units we will ever submit for a buy / sell / approve. */
const GAS_LIMIT_CAP = 3_000_000n;

/** Multiplier (×10 fixed) for `estimateGas` → submitted gas. */
const GAS_BUFFER_NUM = 13n;
const GAS_BUFFER_DEN = 10n;

const viemChain = {
  id: HYPER_EVM.id,
  name: HYPER_EVM.name,
  nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
  rpcUrls: { default: { http: [HYPER_EVM.rpcUrl] } },
} as const;

/**
 * Build the signer-side client for tx submission. Kept separate from
 * `buildPublicClient` so reads (simulation, allowance check) can run
 * without a private key in scope.
 */
const buildWalletClient = (
  env: Pick<Env, "HYPEREVM_RPC_URL">,
  privateKey: Hex,
): WalletClient => {
  const account = privateKeyToAccount(privateKey);
  const url = env.HYPEREVM_RPC_URL ?? HYPER_EVM.rpcUrl;
  return createWalletClient({
    account,
    chain: viemChain,
    transport: http(url, { timeout: SIMULATION_TIMEOUT_MS }),
  });
};

/** Apply the 1.3× gas buffer per AGENTS.md, capped at `GAS_LIMIT_CAP`. */
const bufferGas = (estimated: bigint): bigint => {
  const buffered = (estimated * GAS_BUFFER_NUM) / GAS_BUFFER_DEN;
  return buffered > GAS_LIMIT_CAP ? GAS_LIMIT_CAP : buffered;
};

export interface ExecuteBuyArgs {
  /** Token being bought. */
  token: Hex;
  /** Gross USDC notional, 6-dp raw. */
  usdcAmount: bigint;
  /** Trader EOA. */
  trader: Hex;
  /** EOA private key — signs the tx. Never logged. */
  privateKey: Hex;
  /** Slippage tolerance in bps (e.g. 100 = 1%). */
  slippageBps: number;
  /** Referrer wallet, or zero address. */
  referrer?: Hex;
}

export interface ExecuteSellArgs {
  /** Token being sold. */
  token: Hex;
  /** Token amount, 18-dp raw. */
  tokenAmount: bigint;
  /** Trader EOA. */
  trader: Hex;
  /** EOA private key — signs the tx. Never logged. */
  privateKey: Hex;
  /** Slippage tolerance in bps. */
  slippageBps: number;
  /** Referrer wallet, or zero address. */
  referrer?: Hex;
}

export type ExecutionResult =
  | { ok: true; txHash: Hash; quotedOut: bigint; minOut: bigint }
  | {
      ok: false;
      kind: "not_configured" | "reverted" | "unavailable" | "insufficient_funds";
      reason?: string;
      /**
       * Set when the tx was actually submitted on-chain — i.e. failure
       * happened post-`sendTransaction` (reverted receipt, or receipt
       * wait timed out). Lets the UI surface an explorer link so the
       * user can audit the on-chain outcome themselves.
       */
      txHash?: Hash;
    };

/**
 * Submit `approve(spender, MAX_UINT256)` if current allowance is below
 * `amount`. Returns the approve tx hash when one was sent, `null` when
 * the existing allowance already covers the trade. Failing to set the
 * allowance surfaces as a thrown error so the caller can map it to
 * `unavailable` / `reverted` cleanly.
 */
const ensureAllowance = async (
  publicClient: PublicClient,
  walletClient: WalletClient,
  token: Address,
  owner: Address,
  spender: Address,
  amount: bigint,
): Promise<Hash | null> => {
  const current = (await publicClient.readContract({
    address: token,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [owner, spender],
  })) as bigint;
  if (current >= amount) return null;

  const data = encodeFunctionData({
    abi: ERC20_ABI,
    functionName: "approve",
    args: [spender, MAX_UINT256],
  });
  const estimated = await publicClient.estimateGas({
    account: owner,
    to: token,
    data,
  });
  const hash = await walletClient.sendTransaction({
    account: walletClient.account!,
    chain: viemChain,
    to: token,
    data,
    gas: bufferGas(estimated),
  });
  // Block until the approve is mined — the buy/sell that follows reads
  // allowance from `latest` state and would race otherwise.
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
};

/**
 * Wait for a submitted tx's receipt and translate the outcome into the
 * `ExecutionResult` taxonomy.
 *
 * `sendTransaction` returns a hash as soon as the RPC accepts the tx
 * into the mempool — it tells us nothing about whether the tx reverted
 * on-chain. Without this check the bot would happily render
 * "✅ submitted" for a tx that failed mid-execution (real-world repro:
 * the CHAOS buy that prompted this fix — tx 0x8edc611c…). We block
 * until the receipt is mined and inspect `receipt.status` so the
 * user-facing copy reflects the real chain state.
 *
 * Bounded by `RECEIPT_TIMEOUT_MS`: a stuck node or a pending tx that
 * never mines within the window surfaces as `unavailable` with the
 * txHash attached so the user can check the explorer themselves. Never
 * claim success without an on-chain confirmation.
 */
export const awaitReceipt = async (
  publicClient: PublicClient,
  txHash: Hash,
  successOut: { quotedOut: bigint; minOut: bigint },
): Promise<ExecutionResult> => {
  try {
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
      timeout: RECEIPT_TIMEOUT_MS,
    });
    if (receipt.status !== "success") {
      return {
        ok: false,
        kind: "reverted",
        reason: "execution reverted",
        txHash,
      };
    }
    return { ok: true, txHash, quotedOut: successOut.quotedOut, minOut: successOut.minOut };
  } catch (err) {
    return {
      ok: false,
      kind: "unavailable",
      reason: err instanceof Error ? err.message : String(err),
      txHash,
    };
  }
};

/**
 * Map a thrown viem error to an `ExecutionResult` failure. Walks the
 * cause chain for `ContractFunctionRevertedError` so a router-side
 * revert (e.g. `ERC20InsufficientAllowance`, `SlippageExceeded`)
 * surfaces with its decoded short message instead of viem's wrapper.
 */
const mapExecutionError = (err: unknown): ExecutionResult => {
  if (err instanceof BaseError) {
    const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      return {
        ok: false,
        kind: "reverted",
        reason: reverted.shortMessage,
      };
    }
    const message = err.shortMessage ?? err.message;
    if (/insufficient funds/i.test(message)) {
      return { ok: false, kind: "insufficient_funds", reason: message };
    }
    return { ok: false, kind: "unavailable", reason: message };
  }
  return {
    ok: false,
    kind: "unavailable",
    reason: err instanceof Error ? err.message : String(err),
  };
};

/**
 * Execute a buy through `BotFeeRouter.buyWithBotFee`.
 *
 * Flow:
 *   1. Simulate with `minTokensOut = 0` to get `quotedTokensOut`.
 *   2. Derive `minTokensOut` from `slippageBps`.
 *   3. Ensure USDC allowance ≥ `usdcAmount` for the router; approve
 *      MAX_UINT256 if not.
 *   4. Submit the real `buyWithBotFee` tx with the slippage bound.
 *
 * No permit branch in v1 — USDC on HyperEVM is the only token approved
 * on the buy side, and `approve` is a one-time per-wallet cost. The
 * permit ladder lands when the bot fee router publishes its permit
 * domain.
 */
export const executeBuy = async (
  env: Pick<Env, "HYPEREVM_RPC_URL" | "BOT_FEE_ROUTER_ADDRESS">,
  args: ExecuteBuyArgs,
): Promise<ExecutionResult> => {
  const routerAddr = env.BOT_FEE_ROUTER_ADDRESS?.trim();
  if (!routerAddr) return { ok: false, kind: "not_configured" };

  const publicClient = buildPublicClient(env);
  const walletClient = buildWalletClient(env, args.privateKey);
  const router = asHex(routerAddr) as Address;

  try {
    // Approve BEFORE simulating so a first-buy user (zero USDC allowance)
    // doesn't get a confusing `ERC20InsufficientAllowance` revert mapped
    // to a generic error. Mirrors the order in `executeSell`. Flagged
    // by CodeRabbit on PR #707.
    await ensureAllowance(
      publicClient,
      walletClient,
      USDC_ADDRESS as Address,
      args.trader,
      router,
      args.usdcAmount,
    );

    const sim = await publicClient.simulateContract({
      address: router,
      abi: BotFeeRouterAbi,
      functionName: "buyWithBotFee",
      args: [
        args.token,
        args.usdcAmount,
        0n,
        args.referrer ?? ZERO_ADDRESS,
      ],
      account: args.trader,
    });
    const quotedTokensOut = sim.result;
    const minTokensOut = computeMinTokensOut(quotedTokensOut, args.slippageBps);

    const data = encodeFunctionData({
      abi: BotFeeRouterAbi,
      functionName: "buyWithBotFee",
      args: [
        args.token,
        args.usdcAmount,
        minTokensOut,
        args.referrer ?? ZERO_ADDRESS,
      ],
    });
    const estimated = await publicClient.estimateGas({
      account: args.trader,
      to: router,
      data,
    });
    const txHash = await walletClient.sendTransaction({
      account: walletClient.account!,
      chain: viemChain,
      to: router,
      data,
      gas: bufferGas(estimated),
    });
    return awaitReceipt(publicClient, txHash, {
      quotedOut: quotedTokensOut,
      minOut: minTokensOut,
    });
  } catch (err) {
    return mapExecutionError(err);
  }
};

/**
 * Execute a sell through `BotFeeRouter.sellWithBotFee`.
 *
 * Symmetric to `executeBuy`: simulate → minUsdcOut → ensure token
 * allowance ≥ `tokenAmount` → submit. The simulation already accounts
 * for the bot fee skim, so `minUsdcOut` is the floor on the user's
 * net receipt — the spec's "never submit with minUsdcOut=0" invariant
 * is the reason this path exists.
 */
export const executeSell = async (
  env: Pick<Env, "HYPEREVM_RPC_URL" | "BOT_FEE_ROUTER_ADDRESS">,
  args: ExecuteSellArgs,
): Promise<ExecutionResult> => {
  const routerAddr = env.BOT_FEE_ROUTER_ADDRESS?.trim();
  if (!routerAddr) return { ok: false, kind: "not_configured" };

  const publicClient = buildPublicClient(env);
  const walletClient = buildWalletClient(env, args.privateKey);
  const router = asHex(routerAddr) as Address;

  try {
    await ensureAllowance(
      publicClient,
      walletClient,
      args.token as Address,
      args.trader,
      router,
      args.tokenAmount,
    );

    const sim = await publicClient.simulateContract({
      address: router,
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
    const quotedUsdcOut = sim.result;
    const minUsdcOut = computeMinUsdcOut(quotedUsdcOut, args.slippageBps);

    const data = encodeFunctionData({
      abi: BotFeeRouterAbi,
      functionName: "sellWithBotFee",
      args: [
        args.token,
        args.tokenAmount,
        minUsdcOut,
        args.referrer ?? ZERO_ADDRESS,
      ],
    });
    const estimated = await publicClient.estimateGas({
      account: args.trader,
      to: router,
      data,
    });
    const txHash = await walletClient.sendTransaction({
      account: walletClient.account!,
      chain: viemChain,
      to: router,
      data,
      gas: bufferGas(estimated),
    });
    return awaitReceipt(publicClient, txHash, {
      quotedOut: quotedUsdcOut,
      minOut: minUsdcOut,
    });
  } catch (err) {
    return mapExecutionError(err);
  }
};

/**
 * HyperEVM tx-hash explorer URL. Used by `/buy` and `/sell` to render a
 * receipt link in the confirmation message.
 */
export const explorerTxUrl = (hash: Hash): string =>
  `https://hyperevmscan.io/tx/${hash}`;

/**
 * Map an `ExecutionResult` failure to user-facing copy. Common revert
 * reasons that the router or downstream contracts surface get readable
 * messages; everything else falls back to a generic "transaction
 * failed" with the explorer-checkable wrapper from AGENTS.md.
 */
export const renderExecutionError = (
  result: Extract<ExecutionResult, { ok: false }>,
): string => {
  if (result.kind === "not_configured") {
    return "Trade routing is not yet configured — try again in a moment.";
  }
  if (result.kind === "insufficient_funds") {
    return "Insufficient HYPE for gas — top up the wallet and retry.";
  }
  if (result.kind === "unavailable") {
    if (result.txHash) {
      return (
        `Tx submitted but receipt not seen yet — check the explorer: ` +
        `${explorerTxUrl(result.txHash)}`
      );
    }
    return "RPC unavailable — please try again in a moment.";
  }
  const reason = result.reason ?? "";
  const suffix = result.txHash
    ? ` See ${explorerTxUrl(result.txHash)}.`
    : "";
  if (/TradingNotOpen/i.test(reason)) {
    return `Trading not yet open for this token — wait for the launch delay to clear.${suffix}`;
  }
  if (/InsufficientBalance/i.test(reason)) {
    return `BounceTech LT buffer low — try a smaller amount or retry in ~10s.${suffix}`;
  }
  if (/Slippage|SlippageExceeded|too little|tooLittle/i.test(reason)) {
    return `Price moved past slippage — try again or raise slippage in /settings.${suffix}`;
  }
  if (/mint paused|MintPaused/i.test(reason)) {
    return `Buys paused for this token — BounceTech LT is temporarily mint-paused. Sells still work.${suffix}`;
  }
  if (result.txHash) {
    return `Transaction reverted on-chain${reason ? `: ${reason}` : ""}. See ${explorerTxUrl(result.txHash)}.`;
  }
  return `Transaction failed${reason ? `: ${reason}` : ""}.`;
};
