import {
  CONTRACT_ADDRESSES,
  MAX_TOKEN_IMAGE_URL_LENGTH,
  TokenAbi,
  USDC_ADDRESS,
  ZapAbi,
  utf8ByteLength,
} from "@launchpad/shared";
import {
  maxUint256,
  parseEventLogs,
  parseUnits,
  type Address,
  type Hex,
} from "viem";

import { ensureAllowance } from "../lib/approvals.ts";
import { parseRequiredFloat, parseRequiredInt } from "../lib/cli-args.ts";
import { formatHype, formatUsdc } from "../lib/format.ts";
import { fetchRandomImage } from "../lib/images.ts";
import { explainOnChainRevert } from "../lib/revert-reason.ts";
import {
  errMessage,
  iterationLine,
  iterationStart,
  log,
  section,
  success,
} from "../lib/logger.ts";
import { loadTradableLTs, pickRandomLT } from "../lib/lts.ts";
import { randomTokenIdentity } from "../lib/names.ts";
import { NonceManager } from "../lib/nonce-manager.ts";
import { mineVanitySalt } from "../lib/vanity.ts";

import type {
  AnyScenario,
  IterationResult,
  Scenario,
  ScenarioContext,
  ScenarioResult,
} from "./types.ts";

const USDC_DECIMALS = 6;

/**
 * On-chain `Zap.MIN_SEED_USDC`. We hard-code the floor as the default
 * seed because:
 *   - Below it the launch reverts with `BelowMinSeed` — there's no
 *     useful stress signal in a sweep that always reverts in the first
 *     tx of every iteration.
 *   - The point of this scenario is to mint a bunch of tokens at the
 *     cheapest legal capital outlay; making the seed configurable above
 *     the floor is occasionally useful (curve-mid load tests) and is
 *     surfaced as `--seed-usd`.
 *
 * Keep in sync with `Zap.MIN_SEED_USDC` if the contract floor ever
 * changes — the mirror in `@launchpad/shared` is `MIN_USDC_BUY_AMOUNT`
 * but that constant is the buy-side floor, not the seed floor, and they
 * happen to be the same value today by coincidence.
 */
const DEFAULT_SEED_USDC = 20;

export interface CreateTokensOptions {
  count: number;
  concurrency: number;
  seedUsd: number;
  sellAfter: boolean;
}

export const createTokensScenario: Scenario<CreateTokensOptions> = {
  name: "create-tokens",
  description:
    "Launch N random tokens (image + LT + vanity salt + Zap.createToken) and optionally dump each one immediately back to USDC.",
  helpText: `
Usage:
  create-tokens [--count N] [--concurrency K] [--seed-usd USD] [--no-sell]

Flags:
  --count        Number of tokens to launch end-to-end. Default: 10.
  --concurrency  Parallel in-flight launches. Default: 1. Nonces are
                 managed manually so values > 1 fan out cleanly from
                 one wallet; the bottleneck quickly becomes RPC and
                 the API.
  --seed-usd     USDC amount for the mandatory seed buy. Must be
                 >= MIN_SEED_USDC ($${DEFAULT_SEED_USDC}). Default: $${DEFAULT_SEED_USDC}.
  --no-sell      Skip the post-launch sell. Capital stays tied up in
                 the new tokens — useful when you want to keep curves
                 visibly hot for UI testing.
`.trim(),
  parseOptions(argv) {
    const opts: CreateTokensOptions = {
      count: 10,
      concurrency: 1,
      seedUsd: DEFAULT_SEED_USDC,
      sellAfter: true,
    };
    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i];
      if (arg === "--no-sell") {
        opts.sellAfter = false;
        continue;
      }
      const next = argv[i + 1];
      if (arg === "--count") {
        opts.count = parseRequiredInt(arg, next);
        i++;
      } else if (arg === "--concurrency") {
        opts.concurrency = parseRequiredInt(arg, next);
        i++;
      } else if (arg === "--seed-usd") {
        opts.seedUsd = parseRequiredFloat(arg, next);
        i++;
      } else {
        throw new Error(`Unknown flag for create-tokens: ${arg}`);
      }
    }
    if (opts.count <= 0) throw new Error("--count must be > 0");
    if (opts.concurrency <= 0) throw new Error("--concurrency must be > 0");
    if (opts.seedUsd < DEFAULT_SEED_USDC) {
      throw new Error(
        `--seed-usd must be >= ${DEFAULT_SEED_USDC} (Zap.MIN_SEED_USDC).`,
      );
    }
    return opts;
  },
  run,
};

async function run(
  ctx: ScenarioContext,
  options: CreateTokensOptions,
): Promise<ScenarioResult> {
  const { publicClient, account } = ctx.clients;

  const seedAmount = parseUnits(options.seedUsd.toFixed(USDC_DECIMALS), USDC_DECIMALS);
  // With sell-after enabled (the default), each iteration's seed is
  // recycled back to USDC within ~3-5s of confirmation, so the
  // ACTUAL in-flight capital ceiling is just `seed × concurrency` —
  // requiring the full `seed × count` upfront rejects wallets that
  // are sized correctly for a recycling run. Without sell-after the
  // capital genuinely accumulates in launched tokens and the full
  // `seed × count` is real — keep the stricter check for that mode.
  // CodeRabbit caught the over-constraint on PR #736.
  const inFlightCapital = options.sellAfter
    ? seedAmount * BigInt(options.concurrency)
    : seedAmount * BigInt(options.count);

  await preflight(ctx, inFlightCapital);

  const tradableLTs = await loadTradableLTs();

  const nonceManager = await NonceManager.create(publicClient, account.address);

  section("🔓", "USDC approval");
  // Allowance is set to maxUint256 by `ensureAllowance` whenever the
  // current allowance is below `required`, so the exact value here
  // doesn't bound future spending — we just want a non-zero threshold
  // that triggers the approve on a cold start. `seed × count` is the
  // worst case (no sell-after means every iteration's seed accumulates
  // against the allowance), so that's what we ask for.
  const totalSpend = seedAmount * BigInt(options.count);
  await ensureAllowance({
    publicClient,
    walletClient: ctx.clients.walletClient,
    nonceManager,
    owner: account.address,
    token: USDC_ADDRESS,
    spender: CONTRACT_ADDRESSES.zap as Address,
    required: totalSpend,
    label: "USDC → Zap",
  });

  section("🪂", `Launching ${options.count} tokens · concurrency ${options.concurrency} · seed $${options.seedUsd.toFixed(2)}${options.sellAfter ? " · sell after" : ""}`);

  const queue = Array.from({ length: options.count }, (_, i) => i);
  const results: IterationResult[] = [];
  const totalCount = options.count;

  const workers = Array.from({ length: options.concurrency }, () =>
    workerLoop(queue, ctx, options, nonceManager, tradableLTs, results, totalCount),
  );
  await Promise.all(workers);

  return {
    iterations: results,
    notes: [
      `wallet: ${account.address}`,
      `seed per iter: $${options.seedUsd}`,
      `concurrency: ${options.concurrency}`,
      `sold after launch: ${options.sellAfter ? "yes" : "no"}`,
    ],
  };
}

async function preflight(
  ctx: ScenarioContext,
  inFlightCapital: bigint,
): Promise<void> {
  const { publicClient, account } = ctx.clients;
  section("💰", "Preflight");

  const [usdc, hype] = await Promise.all([
    publicClient.readContract({
      address: USDC_ADDRESS,
      abi: TokenAbi,
      functionName: "balanceOf",
      args: [account.address],
    }),
    publicClient.getBalance({ address: account.address }),
  ]);

  if (usdc < inFlightCapital) {
    throw new Error(
      `Insufficient USDC. Need ${formatUsdc(inFlightCapital)} in flight ` +
        `(seed × concurrency when sell-after, seed × count otherwise); ` +
        `wallet has ${formatUsdc(usdc)}. Top up before re-running.`,
    );
  }
  if (hype === 0n) {
    throw new Error(
      "Wallet holds 0 HYPE — fund it for gas before re-running.",
    );
  }
  success(`${formatUsdc(usdc)} USDC · ${formatHype(hype)} HYPE`);
  log("debug", "preflight_ok", {
    wallet: account.address,
    usdc: formatUsdc(usdc),
    hype: hype.toString(),
    inFlightCapital: formatUsdc(inFlightCapital),
  });
}

async function workerLoop(
  queue: number[],
  ctx: ScenarioContext,
  options: CreateTokensOptions,
  nonceManager: NonceManager,
  tradableLTs: Awaited<ReturnType<typeof loadTradableLTs>>,
  results: IterationResult[],
  totalCount: number,
): Promise<void> {
  while (true) {
    const queueIndex = queue.shift();
    if (queueIndex === undefined) return;

    // 1-based display ordinal, stable across the start + end lines
    // for this iteration. Without a stable ordinal, completions arrive
    // out of order at concurrency > 1 and the numbers in the end-line
    // would no longer match the numbers in the start-line, making
    // the per-iteration trace impossible to follow.
    const ordinal = queueIndex + 1;

    const lt = pickRandomLT(tradableLTs);
    const pairLabel = `${lt.targetAsset}-${lt.targetLeverage}${lt.isLong ? "L" : "S"}`;
    const identity = randomTokenIdentity();

    iterationStart({
      index: ordinal,
      total: totalCount,
      primary: pairLabel,
      secondary: identity.name,
    });

    const result = await runOneIteration(
      ctx,
      options,
      nonceManager,
      ordinal,
      lt,
      pairLabel,
      identity,
    );
    results.push(result);

    iterationLine({
      index: ordinal,
      total: totalCount,
      ok: result.ok,
      primary: pairLabel,
      secondary: identity.name,
      durationMs: result.durationMs,
      error: result.error,
    });
  }
}

async function runOneIteration(
  ctx: ScenarioContext,
  options: CreateTokensOptions,
  nonceManager: NonceManager,
  ordinal: number,
  lt: Awaited<ReturnType<typeof loadTradableLTs>>[number],
  pairLabel: string,
  identity: ReturnType<typeof randomTokenIdentity>,
): Promise<IterationResult> {
  const start = Date.now();
  const { name, ticker, description } = identity;
  try {
    log("debug", "iteration_start", { ordinal, pair: pairLabel, name, ticker });

    // ─── Image upload ────────────────────────────────────────────────
    const image = await fetchRandomImage();
    const uploaded = await ctx.api.uploadImage(image);
    if (utf8ByteLength(uploaded.url) > MAX_TOKEN_IMAGE_URL_LENGTH) {
      throw new Error(
        `API returned image URL longer than MAX_TOKEN_IMAGE_URL_LENGTH (${MAX_TOKEN_IMAGE_URL_LENGTH} bytes) — ${uploaded.url.length} bytes`,
      );
    }

    // ─── Vanity mining (off-thread) ──────────────────────────────────
    // Dispatched to a `node:worker_threads` Worker — see `lib/vanity.ts`
    // for the rationale. The main thread stays free for I/O while this
    // promise is in flight, and concurrent iterations actually run on
    // different cores instead of time-slicing one event loop.
    const mineStart = Date.now();
    const mined = await mineVanitySalt({
      implementation: CONTRACT_ADDRESSES.tokenImplementation as Address,
      bondingProxy: CONTRACT_ADDRESSES.bonding as Address,
      creator: ctx.clients.account.address,
      name,
      ticker,
    });
    log("debug", "vanity_mined", {
      ordinal,
      attempts: mined.attempts,
      durationMs: Date.now() - mineStart,
    });

    // ─── Launch tx (createToken with mandatory seed buy) ─────────────
    const tokenAddress = await launch(
      ctx,
      nonceManager,
      {
        name,
        ticker,
        description,
        image: uploaded.url,
        urls: ["", "", ""],
        ltAddress: lt.address,
        salt: mined.salt,
      },
      parseUnits(options.seedUsd.toFixed(USDC_DECIMALS), USDC_DECIMALS),
    );
    log("debug", "token_launched", {
      ordinal,
      tokenAddress,
      predictedAddress: mined.address,
    });

    // ─── Off-chain registration ──────────────────────────────────────
    // Best-effort — failures here are fully recoverable via the API
    // Worker's 1-minute cron backfill, so they don't fail the iteration.
    try {
      await ctx.api.registerToken(tokenAddress);
      log("debug", "token_registered", { ordinal, tokenAddress });
    } catch (err) {
      log("warn", "token_registration_failed", {
        ordinal,
        tokenAddress,
        error: errMessage(err),
      });
    }

    // ─── Sell back to USDC ───────────────────────────────────────────
    if (options.sellAfter) {
      await sellAll(ctx, nonceManager, tokenAddress);
      log("debug", "token_sold", { ordinal, tokenAddress });
    }

    return {
      ok: true,
      durationMs: Date.now() - start,
      tags: { pair: pairLabel, tokenLabel: name, attempts: mined.attempts },
    };
  } catch (err) {
    return {
      ok: false,
      durationMs: Date.now() - start,
      tags: { pair: pairLabel, tokenLabel: name },
      error: errMessage(err),
    };
  }
}

async function launch(
  ctx: ScenarioContext,
  nonceManager: NonceManager,
  params: {
    name: string;
    ticker: string;
    description: string;
    image: string;
    urls: [string, string, string];
    ltAddress: Address;
    salt: Hex;
  },
  seedUsdcAmount: bigint,
): Promise<Address> {
  const { publicClient, walletClient, account } = ctx.clients;
  const launchArgs = [params, seedUsdcAmount] as const;
  const nonce = await nonceManager.acquire();
  let hash: Hex;
  try {
    hash = await walletClient.writeContract({
      address: CONTRACT_ADDRESSES.zap as Address,
      abi: ZapAbi,
      functionName: "createToken",
      args: launchArgs,
      nonce,
    });
    nonceManager.commit();
  } catch (err) {
    nonceManager.rollback();
    throw new Error(`Zap.createToken submit failed: ${errMessage(err)}`, {
      cause: err,
    });
  }

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status === "reverted") {
    const reason = await explainOnChainRevert(
      publicClient,
      hash,
      {
        address: CONTRACT_ADDRESSES.zap as Address,
        abi: ZapAbi,
        functionName: "createToken",
        args: launchArgs,
      },
      account.address,
    );
    throw new Error(`Zap.createToken reverted on-chain: ${reason} (tx ${hash})`);
  }

  const events = parseEventLogs({
    abi: ZapAbi,
    eventName: "TokenCreated",
    logs: receipt.logs,
    strict: false,
  });
  const tokenAddr = (events[0]?.args as { token?: Address } | undefined)?.token;
  if (!tokenAddr) {
    throw new Error(
      `No TokenCreated event in receipt for ${hash} — Zap or Bonding ABI may be out of date.`,
    );
  }
  return tokenAddr;
}

async function sellAll(
  ctx: ScenarioContext,
  nonceManager: NonceManager,
  tokenAddress: Address,
): Promise<void> {
  const { publicClient, walletClient, account } = ctx.clients;

  // Sells are gated by Zap's per-token allowance, not Bonding's trading
  // delay (which only constrains buys). The launch receipt is already
  // confirmed before we get here, so `balanceOf` reads the post-seed
  // balance the seed buy minted to the creator.
  const balance = (await publicClient.readContract({
    address: tokenAddress,
    abi: TokenAbi,
    functionName: "balanceOf",
    args: [account.address],
  })) as bigint;
  if (balance === 0n) {
    log("warn", "sell_skipped_zero_balance", { tokenAddress });
    throw new Error("Post-launch balance was 0 — seed buy may have failed silently");
  }

  // Approve Zap to pull this iteration's freshly-minted tokens, then
  // WAIT for the approve receipt before submitting the sell.
  //
  // The "wait for receipt" step is load-bearing, not a hot-path
  // optimisation target: viem's `walletClient.writeContract` performs
  // a pre-flight `eth_estimateGas` (essentially a simulation) against
  // the LATEST block state — pending mempool txs are invisible to it.
  // If we submit the sell with the approve still pending, the
  // simulation sees `allowance == 0`, reverts with
  // `ERC20InsufficientAllowance(address,uint256,uint256)`
  // (selector `0xfb8f41b2`), and the sell is never even broadcast.
  // An earlier iteration of this code skipped the receipt wait and
  // every sell failed at simulation time — see the bug surfaced in
  // the `concurrency 1` smoke run with seed-buy → sell.
  const allowance = (await publicClient.readContract({
    address: tokenAddress,
    abi: TokenAbi,
    functionName: "allowance",
    args: [account.address, CONTRACT_ADDRESSES.zap as Address],
  })) as bigint;
  if (allowance < balance) {
    const approveNonce = await nonceManager.acquire();
    let approveHash: Hex;
    try {
      approveHash = await walletClient.writeContract({
        address: tokenAddress,
        abi: TokenAbi,
        functionName: "approve",
        args: [CONTRACT_ADDRESSES.zap as Address, maxUint256],
        nonce: approveNonce,
      });
      nonceManager.commit();
    } catch (err) {
      nonceManager.rollback();
      throw new Error(`Token.approve submit failed: ${errMessage(err)}`, {
        cause: err,
      });
    }
    const approveReceipt = await publicClient.waitForTransactionReceipt({
      hash: approveHash,
    });
    if (approveReceipt.status === "reverted") {
      throw new Error(`Token.approve reverted (tx ${approveHash})`);
    }
  }

  // `minUsdcOut = 0`. This is a stress-test wallet selling on a fresh
  // curve with no other actors — there's no realistic sandwich vector
  // because the same wallet just minted, and the post-launch trading
  // delay isolates us from external buys for the immediate-sell case.
  // Live UIs MUST pass a real slippage bound; see `TradePanel` /
  // `useTradeRouter` for the canonical pattern.
  const sellArgs = [tokenAddress, balance, 0n] as const;
  const sellNonce = await nonceManager.acquire();
  let sellHash: Hex;
  try {
    sellHash = await walletClient.writeContract({
      address: CONTRACT_ADDRESSES.zap as Address,
      abi: ZapAbi,
      functionName: "sell",
      args: sellArgs,
      nonce: sellNonce,
    });
    nonceManager.commit();
  } catch (err) {
    nonceManager.rollback();
    throw new Error(`Zap.sell submit failed: ${errMessage(err)}`, {
      cause: err,
    });
  }
  const sellReceipt = await publicClient.waitForTransactionReceipt({
    hash: sellHash,
  });
  if (sellReceipt.status === "reverted") {
    const reason = await explainOnChainRevert(
      publicClient,
      sellHash,
      {
        address: CONTRACT_ADDRESSES.zap as Address,
        abi: ZapAbi,
        functionName: "sell",
        args: sellArgs,
      },
      account.address,
    );
    throw new Error(`Zap.sell reverted on-chain: ${reason} (tx ${sellHash})`);
  }
}

// Type-erased export for the registry. The constraint exists so the
// runtime registry doesn't have to know each scenario's specific options
// shape — `parseOptions` returns `unknown` from the registry's
// perspective, and `run` accepts whatever it produced.
export const scenario: AnyScenario = createTokensScenario as unknown as AnyScenario;
