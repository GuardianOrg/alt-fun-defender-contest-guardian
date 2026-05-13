/**
 * Trade-volume stress test against a single token.
 *
 * Mirrors realistic creator-period activity: the harness wallet
 * buys and sells the same token over and over at random sizes and
 * (optionally) random intervals, exercising the curve / post-grad
 * AMM math, the indexer's `Trade` write path, the trade-feed
 * WebSocket fan-out, the chart's live-tick bucketing, and every
 * `s-maxage`-cached API surface that flushes when a trade lands.
 *
 * Decision logic per iteration
 * ---------------------------
 *   1. Read the wallet's current USDC + token balance fresh from
 *      RPC (cheap multicall on hot RPCs; sequential otherwise).
 *   2. Decide direction:
 *        - `--no-buy`  → sell (if we hold any tokens, else fail)
 *        - `--no-sell` → buy  (if we hold any USDC ≥ minBuy, else fail)
 *        - else        → random, weighted by `--bias` (default 0.5),
 *                        with hard overrides when one side has zero
 *                        balance.
 *   3. Compute amount:
 *        - buy:  random USDC in `[--buy-min, --buy-max]`
 *        - sell: random fraction of token balance in
 *                `[--sell-frac-min, --sell-frac-max]`
 *   4. Submit `Zap.buy` / `Zap.sell` with `min*Out = 0` (stress
 *      test wallet, no MEV protection needed) and an explicit
 *      sequential nonce.
 *   5. Wait for receipt, then optionally sleep a uniform
 *      `[0, --max-delay-ms]` jitter.
 *
 * Concurrency
 * -----------
 * Same nonce-managed broadcast pipeline as `create-tokens`. K
 * workers each cycle through (read → decide → submit → receipt),
 * sharing the wallet's nonce stream via the `NonceManager`. The
 * balance reads happen INSIDE each worker — concurrent workers may
 * see overlapping snapshots, so a sell amount computed against a
 * stale balance can revert on-chain (insufficient `transferFrom`).
 * That's expected stress signal: it's what would happen if real
 * users hammered the same wallet, and the runner counts the
 * revert as a per-iteration failure without aborting the sweep.
 */

import {
  CONTRACT_ADDRESSES,
  MIN_USDC_BUY_AMOUNT,
  MIN_USDC_SELL_AMOUNT,
  TokenAbi,
  USDC_ADDRESS,
  ZapAbi,
} from "@launchpad/shared";
import {
  parseUnits,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";

import { ensureAllowance } from "../lib/approvals.ts";
import {
  parseAddress,
  parseRequiredFloat,
  parseRequiredInt,
} from "../lib/cli-args.ts";
import { formatFraction, formatHype, formatUsdc } from "../lib/format.ts";
import {
  errMessage,
  iterationLine,
  iterationStart,
  log,
  section,
  success,
} from "../lib/logger.ts";
import { NonceManager } from "../lib/nonce-manager.ts";
import { explainOnChainRevert } from "../lib/revert-reason.ts";

import type {
  AnyScenario,
  IterationResult,
  Scenario,
  ScenarioContext,
  ScenarioResult,
} from "./types.ts";

const USDC_DECIMALS = 6;

export interface TradeTokenOptions {
  token: Address;
  count: number;
  concurrency: number;
  /** Inclusive lower bound of random buy amounts, in USDC dollars. */
  buyMin: number;
  /** Inclusive upper bound of random buy amounts, in USDC dollars. */
  buyMax: number;
  /** Inclusive lower bound of random sell fractions (0..1). */
  sellFracMin: number;
  /** Inclusive upper bound of random sell fractions (0..1). */
  sellFracMax: number;
  /** Probability of buying when both sides are legal. 0 = always sell, 1 = always buy. */
  bias: number;
  /** Uniform random delay in [0, maxDelayMs] inserted after each iteration. */
  maxDelayMs: number;
  /** Disable the buy branch entirely (sell-only). */
  noBuy: boolean;
  /** Disable the sell branch entirely (buy-only). */
  noSell: boolean;
}

export const tradeTokenScenario: Scenario<TradeTokenOptions> = {
  name: "trade-token",
  description:
    "Hammer a single token with randomised buys and sells from one wallet — exercises curve / post-grad AMM, indexer write path, trade feed, chart, and every cached API surface.",
  helpText: `
Usage:
  trade-token --token 0x… [...flags]

Required:
  --token         The token contract address to trade. Must be a
                  live Alt Fun token (curve or graduated).

Flags:
  --count           Number of trades to perform. Default: 100.
  --concurrency     Pipelined in-flight trades. Default: 1.
                    Nonces are managed manually; >1 fans out cleanly
                    but balance-read races may cause more reverts.
  --buy-min         Minimum buy size (USDC). Must be >= $${MIN_USDC_BUY_AMOUNT}. Default: 20.
  --buy-max         Maximum buy size (USDC). Default: 50.
  --sell-frac-min   Minimum sell fraction of token balance (0..1). Default: 0.1.
  --sell-frac-max   Maximum sell fraction (0..1). Default: 0.5.
  --bias            Probability of buying when both sides legal. Default: 0.5.
  --max-delay-ms    Uniform random delay after each iteration (ms). Default: 0.
  --no-buy          Sell-only.
  --no-sell         Buy-only.

Notes:
  * The wallet's USDC + HYPE + initial token balance are read at startup.
  * Sells revert when the (currentBalance × fraction) yields < $${MIN_USDC_SELL_AMOUNT}
    of estimated USDC out (BounceTech LT redemption floor). Counted as
    a per-iteration failure, not a hard abort.
  * Both directions go through Zap and route automatically between curve
    and HyperSwap V2 depending on lifecycle.
`.trim(),
  parseOptions(argv) {
    const opts: TradeTokenOptions = {
      token: "0x0000000000000000000000000000000000000000",
      count: 100,
      concurrency: 1,
      buyMin: MIN_USDC_BUY_AMOUNT,
      buyMax: 50,
      sellFracMin: 0.1,
      sellFracMax: 0.5,
      bias: 0.5,
      maxDelayMs: 0,
      noBuy: false,
      noSell: false,
    };
    let tokenProvided = false;
    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i];
      if (arg === "--no-buy") {
        opts.noBuy = true;
        continue;
      }
      if (arg === "--no-sell") {
        opts.noSell = true;
        continue;
      }
      const next = argv[i + 1];
      if (arg === "--token") {
        opts.token = parseAddress(arg, next);
        tokenProvided = true;
        i++;
      } else if (arg === "--count") {
        opts.count = parseRequiredInt(arg, next);
        i++;
      } else if (arg === "--concurrency") {
        opts.concurrency = parseRequiredInt(arg, next);
        i++;
      } else if (arg === "--buy-min") {
        opts.buyMin = parseRequiredFloat(arg, next);
        i++;
      } else if (arg === "--buy-max") {
        opts.buyMax = parseRequiredFloat(arg, next);
        i++;
      } else if (arg === "--sell-frac-min") {
        opts.sellFracMin = parseRequiredFloat(arg, next);
        i++;
      } else if (arg === "--sell-frac-max") {
        opts.sellFracMax = parseRequiredFloat(arg, next);
        i++;
      } else if (arg === "--bias") {
        opts.bias = parseRequiredFloat(arg, next);
        i++;
      } else if (arg === "--max-delay-ms") {
        opts.maxDelayMs = parseRequiredInt(arg, next);
        i++;
      } else {
        throw new Error(`Unknown flag for trade-token: ${arg}`);
      }
    }
    if (!tokenProvided) {
      throw new Error("--token is required");
    }
    if (opts.count <= 0) throw new Error("--count must be > 0");
    if (opts.concurrency <= 0) throw new Error("--concurrency must be > 0");
    if (opts.buyMin < MIN_USDC_BUY_AMOUNT) {
      throw new Error(`--buy-min must be >= ${MIN_USDC_BUY_AMOUNT}`);
    }
    if (opts.buyMax < opts.buyMin) {
      throw new Error("--buy-max must be >= --buy-min");
    }
    if (opts.sellFracMin <= 0 || opts.sellFracMin > 1) {
      throw new Error("--sell-frac-min must be in (0, 1]");
    }
    if (opts.sellFracMax < opts.sellFracMin || opts.sellFracMax > 1) {
      throw new Error("--sell-frac-max must be in [--sell-frac-min, 1]");
    }
    if (opts.bias < 0 || opts.bias > 1) {
      throw new Error("--bias must be in [0, 1]");
    }
    if (opts.maxDelayMs < 0) {
      throw new Error("--max-delay-ms must be >= 0");
    }
    if (opts.noBuy && opts.noSell) {
      throw new Error("--no-buy and --no-sell together leaves nothing to do");
    }
    return opts;
  },
  run,
};

async function run(
  ctx: ScenarioContext,
  options: TradeTokenOptions,
): Promise<ScenarioResult> {
  const { publicClient, account } = ctx.clients;

  await preflight(ctx, options);

  const nonceManager = await NonceManager.create(publicClient, account.address);

  section("🔓", "Allowances");
  // Approve a large but finite USDC ceiling — we don't know exactly how
  // much will be spent across the run, so we approve well past
  // `count × buyMax × 2` and let the maxUint256 fallback inside
  // `ensureAllowance` do the rest.
  if (!options.noBuy) {
    await ensureAllowance({
      publicClient,
      walletClient: ctx.clients.walletClient,
      nonceManager,
      owner: account.address,
      token: USDC_ADDRESS,
      spender: CONTRACT_ADDRESSES.zap as Address,
      required: parseUnits(
        String(options.buyMax * options.count * 2),
        USDC_DECIMALS,
      ),
      label: "USDC → Zap",
    });
  }
  if (!options.noSell) {
    // Token allowance needs to cover any future sell. The wallet's
    // current token balance is the natural upper bound — approving
    // beyond that wouldn't matter — but we pass `1` so the helper
    // always tops up to maxUint256 on a cold start, and then becomes
    // a no-op on every subsequent run that targets the same token.
    await ensureAllowance({
      publicClient,
      walletClient: ctx.clients.walletClient,
      nonceManager,
      owner: account.address,
      token: options.token,
      spender: CONTRACT_ADDRESSES.zap as Address,
      required: 1n,
      label: "Token → Zap",
    });
  }

  section(
    "🔄",
    `Trading ${options.count} times · concurrency ${options.concurrency}${
      options.maxDelayMs > 0 ? ` · jitter 0-${options.maxDelayMs}ms` : ""
    }`,
  );

  const queue = Array.from({ length: options.count }, (_, i) => i);
  const results: IterationResult[] = [];
  const totalCount = options.count;

  const workers = Array.from({ length: options.concurrency }, () =>
    workerLoop(queue, ctx, options, nonceManager, results, totalCount),
  );
  await Promise.all(workers);

  return {
    iterations: results,
    notes: [
      `token: ${options.token}`,
      `wallet: ${account.address}`,
      `buy range: $${options.buyMin}–$${options.buyMax}`,
      `sell fraction: ${formatFraction(options.sellFracMin)}–${formatFraction(options.sellFracMax)}`,
      `bias (buy): ${formatFraction(options.bias)}`,
      `concurrency: ${options.concurrency}`,
    ],
  };
}

async function preflight(
  ctx: ScenarioContext,
  options: TradeTokenOptions,
): Promise<void> {
  const { publicClient, account } = ctx.clients;
  section("💰", "Preflight");

  const [usdc, hype, tokenBalance, tokenTotalSupply] = await Promise.all([
    publicClient.readContract({
      address: USDC_ADDRESS,
      abi: TokenAbi,
      functionName: "balanceOf",
      args: [account.address],
    }),
    publicClient.getBalance({ address: account.address }),
    publicClient.readContract({
      address: options.token,
      abi: TokenAbi,
      functionName: "balanceOf",
      args: [account.address],
    }),
    // `Token.TOTAL_SUPPLY()` is the cheapest probe that proves
    // `options.token` is a real Alt Fun token clone — a random EOA
    // address would revert on the call, surfacing as a clean preflight
    // error instead of a confusing per-iteration revert later. The
    // 1B-token invariant is enforced by `Token.sol` so we don't need
    // to assert the value, just that the call returns.
    publicClient.readContract({
      address: options.token,
      abi: TokenAbi,
      functionName: "TOTAL_SUPPLY",
    }),
  ]);

  if (hype === 0n) {
    throw new Error(
      "Wallet holds 0 HYPE — fund it for gas before re-running.",
    );
  }

  if (!options.noBuy && usdc < parseUnits(String(options.buyMin), USDC_DECIMALS)) {
    throw new Error(
      `Insufficient USDC for at least one buy. Need ≥$${options.buyMin}, ` +
        `wallet has ${formatUsdc(usdc as bigint)}.`,
    );
  }
  if (options.noBuy && (tokenBalance as bigint) === 0n) {
    throw new Error(
      "--no-buy was set but the wallet holds 0 of this token — there's nothing to sell.",
    );
  }

  success(
    `${formatUsdc(usdc as bigint)} USDC · ${formatHype(hype)} HYPE · ${formatTokenBalance(tokenBalance as bigint, tokenTotalSupply as bigint)} of supply held`,
  );
  log("debug", "preflight_ok", {
    wallet: account.address,
    token: options.token,
    usdc: formatUsdc(usdc as bigint),
    hype: hype.toString(),
    tokenBalance: (tokenBalance as bigint).toString(),
    tokenTotalSupply: (tokenTotalSupply as bigint).toString(),
  });
}

async function workerLoop(
  queue: number[],
  ctx: ScenarioContext,
  options: TradeTokenOptions,
  nonceManager: NonceManager,
  results: IterationResult[],
  totalCount: number,
): Promise<void> {
  while (true) {
    const queueIndex = queue.shift();
    if (queueIndex === undefined) return;
    const ordinal = queueIndex + 1;

    const result = await runOneTrade(ctx, options, nonceManager, ordinal, totalCount);
    results.push(result);
    iterationLine({
      index: ordinal,
      total: totalCount,
      ok: result.ok,
      primary: (result.tags?.direction as string | undefined) ?? "?",
      secondary: (result.tags?.amountLabel as string | undefined) ?? "?",
      durationMs: result.durationMs,
      error: result.error,
    });

    if (options.maxDelayMs > 0) {
      // Uniform `[0, maxDelayMs]` jitter — keeps the trade stream
      // from being perfectly periodic, which makes the live chart /
      // trade feed easier to scan during a long run.
      await sleep(Math.floor(Math.random() * (options.maxDelayMs + 1)));
    }
  }
}

interface TradeDecision {
  direction: "BUY" | "SELL";
  /** Amount in the relevant unit: USDC raw (6dp) for buy, token raw (18dp) for sell. */
  amount: bigint;
  /** Display string for the iteration line (`$25.00` or `35.2%`). */
  amountLabel: string;
}

async function runOneTrade(
  ctx: ScenarioContext,
  options: TradeTokenOptions,
  nonceManager: NonceManager,
  ordinal: number,
  totalCount: number,
): Promise<IterationResult> {
  const start = Date.now();
  // Scoped outside the try so the catch can still attach direction +
  // amount tags when the failure happened AFTER `decide()` produced
  // them — without this, every post-decision failure surfaces as
  // `? · ?` in the iteration line, which loses the signal you'd
  // actually want when scanning a failed run.
  let decision: TradeDecision | undefined;
  try {
    decision = await decide(ctx, options);

    iterationStart({
      index: ordinal,
      total: totalCount,
      primary: decision.direction,
      secondary: decision.amountLabel,
    });

    log("debug", "trade_start", {
      ordinal,
      direction: decision.direction,
      amount: decision.amount.toString(),
    });

    if (decision.direction === "BUY") {
      await submitBuy(ctx, options.token, decision.amount, nonceManager);
    } else {
      await submitSell(ctx, options.token, decision.amount, nonceManager);
    }

    return {
      ok: true,
      durationMs: Date.now() - start,
      tags: {
        direction: decision.direction,
        amountLabel: decision.amountLabel,
      },
    };
  } catch (err) {
    return {
      ok: false,
      durationMs: Date.now() - start,
      tags: {
        direction: decision?.direction ?? "?",
        amountLabel: decision?.amountLabel ?? "?",
      },
      error: errMessage(err),
    };
  }
}

async function decide(
  ctx: ScenarioContext,
  options: TradeTokenOptions,
): Promise<TradeDecision> {
  const { publicClient, account } = ctx.clients;
  const [usdcBalance, tokenBalance] = await Promise.all([
    publicClient.readContract({
      address: USDC_ADDRESS,
      abi: TokenAbi,
      functionName: "balanceOf",
      args: [account.address],
    }) as Promise<bigint>,
    publicClient.readContract({
      address: options.token,
      abi: TokenAbi,
      functionName: "balanceOf",
      args: [account.address],
    }) as Promise<bigint>,
  ]);

  const minBuyRaw = parseUnits(String(options.buyMin), USDC_DECIMALS);
  const canBuy = !options.noBuy && usdcBalance >= minBuyRaw;
  const canSell = !options.noSell && tokenBalance > 0n;

  if (!canBuy && !canSell) {
    throw new Error(
      `Wallet can neither buy (USDC ${formatUsdc(usdcBalance)} < $${options.buyMin}` +
        `${options.noBuy ? " or --no-buy" : ""}) nor sell (token balance ${tokenBalance.toString()}` +
        `${options.noSell ? " or --no-sell" : ""}) — top up the wallet.`,
    );
  }

  let isBuy: boolean;
  if (canBuy && !canSell) isBuy = true;
  else if (canSell && !canBuy) isBuy = false;
  else isBuy = Math.random() < options.bias;

  if (isBuy) {
    const amountUsd = randomFloatInRange(options.buyMin, options.buyMax);
    const amount = parseUnits(amountUsd.toFixed(USDC_DECIMALS), USDC_DECIMALS);
    return {
      direction: "BUY",
      amount,
      amountLabel: `$${amountUsd.toFixed(2)}`,
    };
  }

  const initialFraction = randomFloatInRange(options.sellFracMin, options.sellFracMax);
  const sized = await sizeSellThatClearsMin(
    ctx,
    options.token,
    tokenBalance,
    initialFraction,
  );
  return {
    direction: "SELL",
    amount: sized.amount,
    amountLabel: formatFraction(sized.fraction),
  };
}

/**
 * Pick a sell amount whose simulated USDC out clears the on-chain
 * `MIN_USDC_AMOUNT` floor.
 *
 * Why this exists (and what the alternative looked like)
 * ------------------------------------------------------
 * `Zap.sell` reverts with `BelowMinAmount()` when the redeemed USDC
 * would be below ~`$10`. Under `--concurrency K > 1`, balance reads
 * happen against the latest block and miss in-flight buys — so an
 * iteration that picks "15% of balance" sees only the last
 * confirmed buy's tokens, picks an amount that quotes to a few
 * dollars of USDC, and reverts at submission. The first version of
 * this scenario let those reverts through as iteration failures;
 * over a run with frequent buys + sells the failure rate from this
 * race alone made the output noisy and obscured real signal.
 *
 * Strategy: simulate the sell against the latest block. If it
 * succeeds, ship the chosen fraction as-is. If it reverts with
 * `BelowMinAmount`, double the fraction (capped at 1.0) and try
 * again — at most a handful of doublings before we'd be selling the
 * whole position. If even fraction=1.0 still reverts, the wallet's
 * position is genuinely smaller than `MIN_USDC_AMOUNT` and we throw
 * a clean "position too small to sell" so the iteration reports the
 * actual cause instead of a viem revert stack trace.
 *
 * Non-`BelowMinAmount` simulation reverts propagate unchanged — the
 * caller's catch turns them into a normal iteration failure with the
 * full error attached.
 */
async function sizeSellThatClearsMin(
  ctx: ScenarioContext,
  token: Address,
  tokenBalance: bigint,
  initialFraction: number,
): Promise<{ amount: bigint; fraction: number }> {
  const { publicClient, account } = ctx.clients;

  let fraction = initialFraction;
  // Bounded retry loop. Six doublings starting at e.g. 0.1 reaches
  // ~1.0 fast; capping at 1.0 then attempting once more covers the
  // "sell the whole bag" fallback. Loop terminates either with a
  // successful simulation or with the "position too small" throw.
  for (let attempt = 0; attempt < 8; attempt++) {
    const amount = fractionOfBalance(tokenBalance, fraction);
    if (amount === 0n) {
      throw new Error(
        `Computed sell amount rounded to zero — token balance ${tokenBalance.toString()} too small for fraction ${fraction}.`,
      );
    }

    try {
      await publicClient.simulateContract({
        address: CONTRACT_ADDRESSES.zap as Address,
        abi: ZapAbi,
        functionName: "sell",
        args: [token, amount, 0n],
        account: account.address,
      });
      return { amount, fraction };
    } catch (err) {
      // viem's `BaseError.walk` finds the deepest `ContractFunctionRevertedError`
      // even when it's wrapped in slippage / call-execution errors. We
      // probe its `data` selector against the `BelowMinAmount` ABI.
      if (!isBelowMinAmountRevert(err)) throw err;

      log("debug", "sell_below_min_scaling_up", {
        fraction,
        amount: amount.toString(),
        attempt,
      });

      if (fraction >= 1.0) {
        throw new Error(
          `Sell would yield < $${MIN_USDC_SELL_AMOUNT} USDC even at 100% of balance ` +
            `(${tokenBalance.toString()} tokens). Buy more before selling, or wait ` +
            `for prior buys in this run to confirm.`,
          { cause: err },
        );
      }
      fraction = Math.min(1.0, fraction * 2);
    }
  }
  // Defensive: the loop's exit conditions should make this
  // unreachable, but throwing here keeps the function total.
  throw new Error(
    "Sell sizing failed to converge after 8 attempts — this is a bug.",
  );
}

function fractionOfBalance(balance: bigint, fraction: number): bigint {
  // Token raw amounts are 18dp bigints; we scale the fraction through
  // basis points so the result stays a clean integer without floating
  // through `Number` precision (which loses ~6 decimal digits past the
  // 1e18 ceiling, drifting the sell amount by hundreds of tokens).
  const bps = BigInt(Math.min(10_000, Math.max(0, Math.floor(fraction * 10_000))));
  return (balance * bps) / 10_000n;
}

/**
 * Walk the viem error chain looking for the `BelowMinAmount` selector.
 * Done by raw selector match against the first 4 bytes of the revert
 * data rather than by error name, because viem's `ContractFunctionRevertedError`
 * only attaches a named `errorName` when the error is in the ABI we
 * passed to `simulateContract` — and `BelowMinAmount` IS in `ZapAbi`,
 * but the selector check is robust to future ABI shuffling and to the
 * error originating from a different contract in the call stack that
 * happens to share the selector.
 *
 * Selector source: `keccak256("BelowMinAmount()")` = `0xef577840`,
 * verified via `viem.keccak256(viem.toHex("BelowMinAmount()"))` against
 * the declaration in `packages/contracts/src/Zap.sol`.
 */
const BELOW_MIN_AMOUNT_SELECTOR = "0xef577840";

function isBelowMinAmountRevert(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  // viem errors expose `walk()` to traverse the cause chain. Fall back
  // to repeated `cause` traversal when `walk` isn't available (non-viem
  // errors that just happen to wrap a viem one).
  type WalkableError = Error & {
    walk?: (predicate?: (e: Error) => boolean) => Error | undefined;
    data?: string;
    cause?: unknown;
  };
  const root = err as WalkableError;

  if (typeof root.walk === "function") {
    const found = root.walk(
      (inner) =>
        typeof (inner as WalkableError).data === "string" &&
        (inner as WalkableError).data!.toLowerCase().startsWith(
          BELOW_MIN_AMOUNT_SELECTOR,
        ),
    );
    if (found) return true;
  }

  let cursor: unknown = err;
  while (cursor instanceof Error) {
    const cursorErr = cursor as WalkableError;
    if (
      typeof cursorErr.data === "string" &&
      cursorErr.data.toLowerCase().startsWith(BELOW_MIN_AMOUNT_SELECTOR)
    ) {
      return true;
    }
    cursor = cursorErr.cause;
  }
  return false;
}

async function submitBuy(
  ctx: ScenarioContext,
  token: Address,
  usdcAmount: bigint,
  nonceManager: NonceManager,
): Promise<void> {
  const { publicClient, walletClient, account } = ctx.clients;
  const buyArgs = [token, usdcAmount, 0n, zeroAddress] as const;
  const nonce = await nonceManager.acquire();
  let hash: Hex;
  try {
    hash = await walletClient.writeContract({
      address: CONTRACT_ADDRESSES.zap as Address,
      abi: ZapAbi,
      functionName: "buy",
      args: buyArgs,
      nonce,
    });
    nonceManager.commit();
  } catch (err) {
    nonceManager.rollback();
    throw new Error(`Zap.buy submit failed: ${errMessage(err)}`, { cause: err });
  }
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status === "reverted") {
    const reason = await explainOnChainRevert(
      publicClient,
      hash,
      {
        address: CONTRACT_ADDRESSES.zap as Address,
        abi: ZapAbi,
        functionName: "buy",
        args: buyArgs,
      },
      account.address,
    );
    throw new Error(`Zap.buy reverted on-chain: ${reason} (tx ${hash})`);
  }
}

async function submitSell(
  ctx: ScenarioContext,
  token: Address,
  tokenAmount: bigint,
  nonceManager: NonceManager,
): Promise<void> {
  const { publicClient, walletClient, account } = ctx.clients;
  const sellArgs = [token, tokenAmount, 0n] as const;
  const nonce = await nonceManager.acquire();
  let hash: Hex;
  try {
    hash = await walletClient.writeContract({
      address: CONTRACT_ADDRESSES.zap as Address,
      abi: ZapAbi,
      functionName: "sell",
      args: sellArgs,
      nonce,
    });
    nonceManager.commit();
  } catch (err) {
    nonceManager.rollback();
    throw new Error(`Zap.sell submit failed: ${errMessage(err)}`, { cause: err });
  }
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status === "reverted") {
    const reason = await explainOnChainRevert(
      publicClient,
      hash,
      {
        address: CONTRACT_ADDRESSES.zap as Address,
        abi: ZapAbi,
        functionName: "sell",
        args: sellArgs,
      },
      account.address,
    );
    throw new Error(`Zap.sell reverted on-chain: ${reason} (tx ${hash})`);
  }
}

function randomFloatInRange(min: number, max: number): number {
  if (max === min) return min;
  return min + Math.random() * (max - min);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatTokenBalance(balance: bigint, totalSupply: bigint): string {
  if (totalSupply === 0n) return "0%";
  // Compute fraction in basis points to avoid `Number` overflow on the
  // 1e18-scaled supply.
  const bps = Number((balance * 10_000n) / totalSupply);
  return `${(bps / 100).toFixed(2)}%`;
}

export const scenario: AnyScenario = tradeTokenScenario as unknown as AnyScenario;
