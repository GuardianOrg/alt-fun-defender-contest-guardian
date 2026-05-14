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
  WaitForTransactionReceiptTimeoutError,
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  domainSeparator,
  encodeFunctionData,
  http,
  parseAbi,
  parseSignature,
  type Address,
  type Hash,
  type Log,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  claimIntent,
  markFinal,
  markSubmitted,
  type IdempotencyKv,
  type IntentRecord,
  type IntentResult,
} from "./idempotency.js";
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
 * Minimal ERC-20 + EIP-2612 surface. `allowance` / `approve` drive the
 * legacy fallback; `name` / `nonces` / `DOMAIN_SEPARATOR` are read when
 * we attempt the permit-first path.
 */
const ERC20_ABI = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function name() view returns (string)",
  "function nonces(address owner) view returns (uint256)",
  "function DOMAIN_SEPARATOR() view returns (bytes32)",
]);

/**
 * EIP-2612 permit deadline window. 30 min mirrors `useTradeRouter` in
 * apps/web — long enough that sim + approve + submit always fit; short
 * enough that a leaked signature is not a long-term liability.
 */
const PERMIT_DEADLINE_SECONDS = 30n * 60n;

/**
 * USDC on HyperEVM is FiatTokenV2_2, whose EIP-712 domain pins
 * `version: "2"`. Every Token clone launched by this protocol inherits
 * OpenZeppelin's `ERC20Permit`, which hardcodes `version: "1"`. Picking
 * the wrong string drifts the computed `DOMAIN_SEPARATOR` and the
 * eventual `ecrecover` inside `permit()` reverts. We cross-check against
 * the on-chain separator below so a third token vintage surfaces as a
 * clean fallback to the approve path instead of a confusing revert.
 */
const permitVersionFor = (token: Hex): string =>
  token.toLowerCase() === USDC_ADDRESS.toLowerCase() ? "2" : "1";

interface PermitTypedDataArgs {
  name: string;
  version: string;
  verifyingContract: Hex;
  owner: Hex;
  spender: Hex;
  value: bigint;
  nonce: bigint;
  deadline: bigint;
}

const buildPermitTypedData = (args: PermitTypedDataArgs) =>
  ({
    domain: {
      name: args.name,
      version: args.version,
      chainId: HYPER_EVM.id,
      verifyingContract: args.verifyingContract,
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
    primaryType: "Permit" as const,
    message: {
      owner: args.owner,
      spender: args.spender,
      value: args.value,
      nonce: args.nonce,
      deadline: args.deadline,
    },
  }) as const;

export interface PermitSignature {
  value: bigint;
  deadline: bigint;
  v: number;
  r: Hex;
  s: Hex;
}

/**
 * Sign an EIP-2612 permit for an arbitrary ERC-20. Reads `name`,
 * `nonces(owner)`, and `DOMAIN_SEPARATOR` on-chain (one RPC round-trip
 * via `Promise.all`), builds the typed data with the per-token version
 * string, verifies the computed domain separator matches the on-chain
 * one, then signs with the custodial private key.
 *
 * Throws if the token does not implement EIP-2612 (revert on `nonces` /
 * `DOMAIN_SEPARATOR`), or if the computed domain separator drifts from
 * the on-chain value. Callers (`executeBuy` / `executeSell`) catch the
 * throw and fall back to the legacy approve path — that "permit-first,
 * approve as fallback" ladder is the spec from apps/telegram-bot/AGENTS.md.
 */
export const signPermitForRouter = async (
  publicClient: PublicClient,
  privateKey: Hex,
  args: {
    token: Hex;
    owner: Hex;
    spender: Hex;
    value: bigint;
    deadline: bigint;
  },
): Promise<PermitSignature> => {
  const { token, owner, spender, value, deadline } = args;

  const [name, nonce, onChainDomainSep] = (await Promise.all([
    publicClient.readContract({
      address: token as Address,
      abi: ERC20_ABI,
      functionName: "name",
    }),
    publicClient.readContract({
      address: token as Address,
      abi: ERC20_ABI,
      functionName: "nonces",
      args: [owner as Address],
    }),
    publicClient.readContract({
      address: token as Address,
      abi: ERC20_ABI,
      functionName: "DOMAIN_SEPARATOR",
    }),
  ])) as [string, bigint, Hex];

  const typedData = buildPermitTypedData({
    name,
    version: permitVersionFor(token),
    verifyingContract: token,
    owner,
    spender,
    value,
    nonce,
    deadline,
  });

  const computedDomainSep = domainSeparator({ domain: typedData.domain });
  if (computedDomainSep.toLowerCase() !== onChainDomainSep.toLowerCase()) {
    throw new Error(
      `EIP-712 domain mismatch for ${token}: on-chain ${onChainDomainSep} vs computed ${computedDomainSep}`,
    );
  }

  const account = privateKeyToAccount(privateKey);
  const signature = await account.signTypedData(typedData);
  const { r, s, v, yParity } = parseSignature(signature);
  const recovery = v !== undefined ? Number(v) : yParity !== undefined ? yParity + 27 : undefined;
  if (recovery === undefined) {
    throw new Error("Permit signature missing recovery parameter");
  }
  return { value, deadline, v: recovery, r, s };
};

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

/**
 * KV-backed commit-log binding for trade idempotency. When provided,
 * `executeBuy` / `executeSell` claim a slot in KV before `sendTransaction`
 * fires; a retry of the same `(userId, nonce)` reads the existing record and
 * returns the recorded outcome instead of submitting a second tx. See
 * `lib/idempotency.ts` for the protocol.
 */
export interface IdempotencyBinding {
  kv: IdempotencyKv;
  key: string;
}

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
  /** Optional KV commit-log to dedupe submission retries. */
  idempotency?: IdempotencyBinding;
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
  /** Optional KV commit-log to dedupe submission retries. */
  idempotency?: IdempotencyBinding;
}

export type ExecutionResult =
  | {
      ok: true;
      txHash: Hash;
      quotedOut: bigint;
      minOut: bigint;
      /**
       * Tokens actually received on a buy, parsed from the
       * `BotRouterTrade.tokenAmount` field of the receipt's log. Undefined
       * for sells (where `BotRouterTrade.tokenAmount` is the tokens *sold*,
       * not received) and when the event can't be decoded from the receipt
       * (e.g. a future router version that doesn't emit the event, or a
       * partial-log receipt). Callers render this when present and fall
       * back to `quotedOut` otherwise.
       */
      actualTokensOut?: bigint;
      /**
       * Net USDC the user actually received on a sell, computed as
       * `BotRouterTrade.usdcAmount - BotRouterTrade.botFee` from the
       * receipt's log (the gross sell proceeds minus the router's bot-fee
       * skim — the post-fee number that actually lands in the user's
       * wallet). Undefined for buys and when the event can't be decoded.
       * Callers render this when present and fall back to `quotedOut`
       * otherwise.
       */
      actualUsdcOut?: bigint;
    }
  /**
   * Tx was accepted into the mempool but `waitForTransactionReceipt`
   * didn't mine within `RECEIPT_TIMEOUT_MS`. Distinct from `unavailable`
   * (RPC error, no on-chain action) and `reverted` (mined-and-failed) —
   * the chain may still settle this hash as success or revert later, so
   * the UI must render a neutral "pending, check explorer" message
   * rather than ❌. `txHash` is required: receipt-timeout is only
   * reachable after `sendTransaction` returned, so the invariant is
   * encoded in the type.
   */
  | { ok: false; kind: "pending"; reason?: string; txHash: Hash }
  | {
      ok: false;
      kind:
        | "not_configured"
        | "reverted"
        | "unavailable"
        | "insufficient_funds";
      reason?: string;
      /**
       * Set when the tx was actually submitted on-chain — i.e. failure
       * happened post-`sendTransaction` (reverted receipt). Lets the UI
       * surface an explorer link so the user can audit the on-chain
       * outcome themselves.
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
 * Decode the `BotRouterTrade` event from a receipt's logs and return its
 * `tokenAmount` field. Used by `awaitReceipt` to surface the real tokens
 * received on a confirmed buy — the on-chain truth, not the pre-trade
 * quote, so the user sees what actually landed in their wallet even if
 * slippage moved the trade between sim and execution.
 *
 * Returns `undefined` when the event isn't present (router version drift,
 * a relayer that strips logs) or when decoding fails — callers fall back
 * to the simulation quote rather than failing the whole reply. We only
 * read the first matching log; the router emits exactly one
 * `BotRouterTrade` per trade.
 */
const extractBuyTokensOut = (logs: readonly Log[]): bigint | undefined => {
  for (const log of logs) {
    try {
      const decoded = decodeEventLog({
        abi: BotFeeRouterAbi,
        eventName: "BotRouterTrade",
        topics: log.topics,
        data: log.data,
      });
      const args = decoded.args as { tokenAmount?: bigint };
      if (typeof args.tokenAmount === "bigint") return args.tokenAmount;
    } catch {
      // Not a BotRouterTrade log — skip.
    }
  }
  return undefined;
};

/**
 * Decode the `BotRouterTrade` event from a sell receipt's logs and return
 * the net USDC the user actually received — `usdcAmount - botFee`. Per
 * the ABI: on a sell `usdcAmount` is the gross USDC out before the
 * router's bot-fee skim, so the post-fee net (what hits the user's
 * wallet) is the gross minus `botFee`. Mirrors `extractBuyTokensOut` —
 * returns undefined when the event isn't present or decoding fails so
 * callers can fall back to the simulation quote.
 */
const extractSellUsdcOut = (logs: readonly Log[]): bigint | undefined => {
  for (const log of logs) {
    try {
      const decoded = decodeEventLog({
        abi: BotFeeRouterAbi,
        eventName: "BotRouterTrade",
        topics: log.topics,
        data: log.data,
      });
      const args = decoded.args as { usdcAmount?: bigint; botFee?: bigint };
      if (
        typeof args.usdcAmount === "bigint" &&
        typeof args.botFee === "bigint"
      ) {
        const net = args.usdcAmount - args.botFee;
        return net >= 0n ? net : undefined;
      }
    } catch {
      // Not a BotRouterTrade log — skip.
    }
  }
  return undefined;
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
 * never mines within the window surfaces as `pending` with the txHash
 * attached so the UI can render "tx pending — check explorer" (⏳, not
 * ❌) instead of misleading the user into thinking the trade failed.
 * Other RPC failures still surface as `unavailable`. Never claim success
 * without an on-chain confirmation.
 */
export const awaitReceipt = async (
  publicClient: PublicClient,
  txHash: Hash,
  successOut: { quotedOut: bigint; minOut: bigint; side?: "buy" | "sell" },
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
    const actualTokensOut =
      successOut.side === "buy"
        ? extractBuyTokensOut(receipt.logs)
        : undefined;
    const actualUsdcOut =
      successOut.side === "sell"
        ? extractSellUsdcOut(receipt.logs)
        : undefined;
    return {
      ok: true,
      txHash,
      quotedOut: successOut.quotedOut,
      minOut: successOut.minOut,
      ...(actualTokensOut !== undefined ? { actualTokensOut } : {}),
      ...(actualUsdcOut !== undefined ? { actualUsdcOut } : {}),
    };
  } catch (err) {
    // Receipt-timeout is the common case here: the tx is in the mempool
    // and may still mine to success or revert. Surface as `pending` so
    // the user sees a neutral "check explorer" message instead of a
    // failure indicator. Anything else (network drop, RPC 5xx, malformed
    // response) stays `unavailable`.
    if (
      err instanceof WaitForTransactionReceiptTimeoutError ||
      (err instanceof Error && err.name === "WaitForTransactionReceiptTimeoutError")
    ) {
      return {
        ok: false,
        kind: "pending",
        reason: err.message,
        txHash,
      };
    }
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
 * Try to sign an EIP-2612 permit for `token` against the router. Returns
 * `null` when the token does not implement permit, when the signing call
 * itself fails (pre-permit vintage, RPC blip on the metadata reads, or a
 * domain-separator drift), so the caller can fall back to the legacy
 * `approve` path without crashing the trade. The permit-first / approve-
 * fallback ladder is the spec from apps/telegram-bot/AGENTS.md.
 *
 * `value` MUST equal the amount the router forwards into `permit()` on
 * chain — i.e. the trade's `usdcAmount` (buy) / `tokenAmount` (sell),
 * never `maxUint256`. `BotFeeRouter.{buy,sell}WithBotFeePermit` passes
 * the trade amount as the permit `value`, so signing any other amount
 * makes the EIP-712 digest diverge from the one the contract
 * reconstructs, `ecrecover` returns the wrong signer, and the call
 * reverts with `ERC2612InvalidSigner` (selector `0x4b800e46`). Web
 * gets away with `maxUint256` only because `Zap.{buy,sell}WithPermit`
 * takes a `PermitData` struct whose `value` field is signed
 * independently — a different on-chain shape, not the same router.
 */
export const tryPermit = async (
  publicClient: PublicClient,
  privateKey: Hex,
  args: {
    token: Hex;
    owner: Hex;
    spender: Hex;
    value: bigint;
    deadline: bigint;
  },
): Promise<PermitSignature | null> => {
  try {
    return await signPermitForRouter(publicClient, privateKey, args);
  } catch {
    return null;
  }
};

const permitDeadline = (): bigint =>
  BigInt(Math.floor(Date.now() / 1000)) + PERMIT_DEADLINE_SECONDS;

/**
 * Project an `ExecutionResult` onto the JSON-safe shape we persist in the
 * commit-log. `bigint`s are stringified so the record round-trips through
 * `JSON.stringify` — `JSON.parse` cannot rehydrate them on its own.
 */
const toIntentResult = (result: ExecutionResult): IntentResult => {
  if (result.ok) {
    return {
      ok: true,
      txHash: result.txHash,
      quotedOut: result.quotedOut.toString(),
      minOut: result.minOut.toString(),
      ...(result.actualTokensOut !== undefined
        ? { actualTokensOut: result.actualTokensOut.toString() }
        : {}),
      ...(result.actualUsdcOut !== undefined
        ? { actualUsdcOut: result.actualUsdcOut.toString() }
        : {}),
    };
  }
  return {
    ok: false,
    kind: result.kind,
    reason: result.reason,
    txHash: result.txHash,
  };
};

/**
 * Persist the receipt outcome to the commit-log, skipping `pending` so the
 * record stays at `status: "submitted"` with the txHash intact. A retry of
 * the same idempotency key then re-enters `resolveDuplicate`, which sees
 * `submitted` + txHash and re-polls the receipt — letting a tx that mines
 * after our local timeout still surface success/revert on retry instead
 * of being frozen as a permanent failure.
 */
const recordReceiptOutcome = async (
  kv: IdempotencyKv,
  key: string,
  result: ExecutionResult,
): Promise<void> => {
  if (!result.ok && result.kind === "pending") return;
  await markFinal(kv, key, toIntentResult(result));
};

/**
 * Reverse of `toIntentResult` — rebuild the `ExecutionResult` from the stored
 * record. Used when a retry hits a duplicate commit-log entry and we want to
 * surface the original outcome instead of submitting again. Defensive on
 * malformed data: a record we can't decode falls back to `unavailable` so
 * callers don't crash and at worst the user sees a retry prompt.
 */
const fromIntentResult = (
  result: IntentResult | undefined,
): ExecutionResult | null => {
  if (!result) return null;
  if (result.ok) {
    if (!result.txHash || result.quotedOut === undefined || result.minOut === undefined) {
      return null;
    }
    try {
      const actualTokensOut =
        result.actualTokensOut !== undefined
          ? BigInt(result.actualTokensOut)
          : undefined;
      const actualUsdcOut =
        result.actualUsdcOut !== undefined
          ? BigInt(result.actualUsdcOut)
          : undefined;
      return {
        ok: true,
        txHash: result.txHash,
        quotedOut: BigInt(result.quotedOut),
        minOut: BigInt(result.minOut),
        ...(actualTokensOut !== undefined ? { actualTokensOut } : {}),
        ...(actualUsdcOut !== undefined ? { actualUsdcOut } : {}),
      };
    } catch {
      return null;
    }
  }
  // `pending` is its own discriminated arm in `ExecutionResult` and
  // requires a non-optional txHash. A commit-log record with `pending`
  // and a missing hash is malformed (we never persist pending — the
  // record stays at `submitted` instead, see `recordReceiptOutcome`),
  // so degrade to `unavailable` rather than fabricating a Hash.
  const kind = result.kind ?? "unavailable";
  if (kind === "pending") {
    if (!result.txHash) {
      return { ok: false, kind: "unavailable", reason: result.reason };
    }
    return { ok: false, kind: "pending", reason: result.reason, txHash: result.txHash };
  }
  return {
    ok: false,
    kind,
    reason: result.reason,
    txHash: result.txHash,
  };
};

/**
 * Map a duplicate commit-log record to a safe `ExecutionResult`:
 *
 *   - `completed` / `failed` → return the recorded outcome verbatim (the user
 *     sees the same Confirm reply the original tap produced).
 *   - `submitted` → we know a tx hash but the original receipt-wait didn't
 *     persist a final result (Worker died, RPC stalled, etc). Re-poll the
 *     receipt here so the retry can still surface success/revert correctly
 *     without firing a second on-chain tx.
 *   - `submitting` → we claimed the slot but `sendTransaction` either didn't
 *     return or crashed before we could record the hash. Refuse to resubmit;
 *     surface `unavailable` so the user can check the explorer / retry the
 *     trade after the TTL window.
 */
const resolveDuplicate = async (
  publicClient: PublicClient,
  record: IntentRecord,
  side: "buy" | "sell",
): Promise<ExecutionResult> => {
  const decoded = fromIntentResult(record.result);
  if (decoded) return decoded;
  if (record.status === "submitted" && record.txHash) {
    // Receipt wasn't persisted last time around — re-await it now. Falls
    // through to the same `awaitReceipt` taxonomy as the happy path.
    return awaitReceipt(publicClient, record.txHash, {
      quotedOut: 0n,
      minOut: 0n,
      side,
    });
  }
  return {
    ok: false,
    kind: "unavailable",
    reason:
      "Trade already in flight — wait a moment, then check the explorer or retry.",
    txHash: record.txHash,
  };
};

/**
 * Execute a buy through `BotFeeRouter.buyWithBotFee[Permit]`.
 *
 * Permit-first ladder per apps/telegram-bot/AGENTS.md → *Permit-first,
 * approve as fallback*:
 *   1. If router already has sufficient allowance, skip straight to the
 *      plain `buyWithBotFee` path.
 *   2. Otherwise try `signPermitForRouter` on USDC. On success, simulate
 *      + submit `buyWithBotFeePermit` — one tx, no approve roundtrip.
 *   3. If permit signing throws (pre-permit USDC, domain drift, RPC
 *      blip), submit `approve(maxUint256)` and follow with plain
 *      `buyWithBotFee`. Same slippage discipline either way.
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
  const referrer = args.referrer ?? ZERO_ADDRESS;
  const usdc = USDC_ADDRESS as Address;

  try {
    const existingAllowance = (await publicClient.readContract({
      address: usdc,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [args.trader as Address, router],
    })) as bigint;

    let permit: PermitSignature | null = null;
    if (existingAllowance < args.usdcAmount) {
      permit = await tryPermit(publicClient, args.privateKey, {
        token: USDC_ADDRESS as Hex,
        owner: args.trader,
        spender: router as Hex,
        value: args.usdcAmount,
        deadline: permitDeadline(),
      });
      if (!permit) {
        // Fallback: legacy `approve` then plain `buyWithBotFee`.
        await ensureAllowance(
          publicClient,
          walletClient,
          usdc,
          args.trader,
          router,
          args.usdcAmount,
        );
      }
    }

    // Simulation is `eth_call`-based and does not consume the permit
    // nonce, so the permit branch can quote against the post-permit
    // state safely. We always quote against the function we will
    // actually submit.
    const sim = permit
      ? await publicClient.simulateContract({
          address: router,
          abi: BotFeeRouterAbi,
          functionName: "buyWithBotFeePermit",
          args: [
            args.token,
            args.usdcAmount,
            0n,
            referrer,
            permit.deadline,
            permit.v,
            permit.r,
            permit.s,
          ],
          account: args.trader,
        })
      : await publicClient.simulateContract({
          address: router,
          abi: BotFeeRouterAbi,
          functionName: "buyWithBotFee",
          args: [args.token, args.usdcAmount, 0n, referrer],
          account: args.trader,
        });
    const quotedTokensOut = sim.result;
    const minTokensOut = computeMinTokensOut(quotedTokensOut, args.slippageBps);

    const data = permit
      ? encodeFunctionData({
          abi: BotFeeRouterAbi,
          functionName: "buyWithBotFeePermit",
          args: [
            args.token,
            args.usdcAmount,
            minTokensOut,
            referrer,
            permit.deadline,
            permit.v,
            permit.r,
            permit.s,
          ],
        })
      : encodeFunctionData({
          abi: BotFeeRouterAbi,
          functionName: "buyWithBotFee",
          args: [args.token, args.usdcAmount, minTokensOut, referrer],
        });
    const estimated = await publicClient.estimateGas({
      account: args.trader,
      to: router,
      data,
    });

    // Claim the idempotency slot in the narrowest possible window — after
    // every read-only step (simulate, gas estimate) and immediately before
    // `sendTransaction`. Putting it any earlier would mean a retry that
    // arrived while the original was still warming up couldn't even reach
    // sendTransaction itself; putting it later (after the hash is back) is
    // useless because the on-chain tx has already fired.
    if (args.idempotency) {
      const claim = await claimIntent(
        args.idempotency.kv,
        args.idempotency.key,
      );
      if (claim.kind === "duplicate") {
        return resolveDuplicate(publicClient, claim.record, "buy");
      }
    }

    const txHash = await walletClient.sendTransaction({
      account: walletClient.account!,
      chain: viemChain,
      to: router,
      data,
      gas: bufferGas(estimated),
    });

    if (args.idempotency) {
      await markSubmitted(args.idempotency.kv, args.idempotency.key, txHash);
    }

    const result = await awaitReceipt(publicClient, txHash, {
      quotedOut: quotedTokensOut,
      minOut: minTokensOut,
      side: "buy",
    });

    if (args.idempotency) {
      await recordReceiptOutcome(
        args.idempotency.kv,
        args.idempotency.key,
        result,
      );
    }

    return result;
  } catch (err) {
    return mapExecutionError(err);
  }
};

/**
 * Execute a sell through `BotFeeRouter.sellWithBotFee[Permit]`.
 *
 * Permit-first ladder symmetric to `executeBuy`. Token clones inherit
 * OZ `ERC20Permit` so the permit branch is the default; pre-permit
 * vintages (or a domain-separator drift) fall back to the legacy
 * `approve` path. `minUsdcOut` is the floor on the user's net receipt
 * either way — never submit with `minUsdcOut = 0`.
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
  const referrer = args.referrer ?? ZERO_ADDRESS;
  const tokenAddr = args.token as Address;

  try {
    const existingAllowance = (await publicClient.readContract({
      address: tokenAddr,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [args.trader as Address, router],
    })) as bigint;

    let permit: PermitSignature | null = null;
    if (existingAllowance < args.tokenAmount) {
      permit = await tryPermit(publicClient, args.privateKey, {
        token: args.token,
        owner: args.trader,
        spender: router as Hex,
        value: args.tokenAmount,
        deadline: permitDeadline(),
      });
      if (!permit) {
        await ensureAllowance(
          publicClient,
          walletClient,
          tokenAddr,
          args.trader,
          router,
          args.tokenAmount,
        );
      }
    }

    const sim = permit
      ? await publicClient.simulateContract({
          address: router,
          abi: BotFeeRouterAbi,
          functionName: "sellWithBotFeePermit",
          args: [
            args.token,
            args.tokenAmount,
            0n,
            referrer,
            permit.deadline,
            permit.v,
            permit.r,
            permit.s,
          ],
          account: args.trader,
        })
      : await publicClient.simulateContract({
          address: router,
          abi: BotFeeRouterAbi,
          functionName: "sellWithBotFee",
          args: [args.token, args.tokenAmount, 0n, referrer],
          account: args.trader,
        });
    const quotedUsdcOut = sim.result;
    const minUsdcOut = computeMinUsdcOut(quotedUsdcOut, args.slippageBps);

    const data = permit
      ? encodeFunctionData({
          abi: BotFeeRouterAbi,
          functionName: "sellWithBotFeePermit",
          args: [
            args.token,
            args.tokenAmount,
            minUsdcOut,
            referrer,
            permit.deadline,
            permit.v,
            permit.r,
            permit.s,
          ],
        })
      : encodeFunctionData({
          abi: BotFeeRouterAbi,
          functionName: "sellWithBotFee",
          args: [args.token, args.tokenAmount, minUsdcOut, referrer],
        });
    const estimated = await publicClient.estimateGas({
      account: args.trader,
      to: router,
      data,
    });

    if (args.idempotency) {
      const claim = await claimIntent(
        args.idempotency.kv,
        args.idempotency.key,
      );
      if (claim.kind === "duplicate") {
        return resolveDuplicate(publicClient, claim.record, "sell");
      }
    }

    const txHash = await walletClient.sendTransaction({
      account: walletClient.account!,
      chain: viemChain,
      to: router,
      data,
      gas: bufferGas(estimated),
    });

    if (args.idempotency) {
      await markSubmitted(args.idempotency.kv, args.idempotency.key, txHash);
    }

    const result = await awaitReceipt(publicClient, txHash, {
      quotedOut: quotedUsdcOut,
      minOut: minUsdcOut,
      side: "sell",
    });

    if (args.idempotency) {
      await recordReceiptOutcome(
        args.idempotency.kv,
        args.idempotency.key,
        result,
      );
    }

    return result;
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
  if (result.kind === "pending") {
    return (
      `Tx pending — receipt not seen within ${RECEIPT_TIMEOUT_MS / 1000}s. ` +
      `Check the explorer: ${explorerTxUrl(result.txHash)}`
    );
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
