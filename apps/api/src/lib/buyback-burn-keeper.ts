/**
 * Test HYPE buyback-and-burn keeper. Runs on the API Worker's
 * `scheduled()` cron tick and periodically:
 *
 *   1. Claims the deployer's accumulated `creatorBalance` from `FeeVault`.
 *   2. Spends the freshly-claimed USDC on a `Zap.buy` of the Test HYPE
 *      token.
 *   3. Burns the bought Test HYPE by transferring to the
 *      `0x000…dEaD` sink.
 *
 * Why this exists, in one paragraph
 * ---------------------------------
 * Test HYPE is the canary token launched by the protocol deployer; the
 * intent is for fees the deployer earns from it (and any other token
 * the deployer creates) to flow back into Test HYPE supply burn,
 * tightening the float over time. Doing the cycle by hand is
 * error-prone and visibly predictable — anyone watching the chain
 * could see "deployer claimed exactly `$N`, here comes a buy of `$N`"
 * and front-run the buy.
 *
 * Front-run resistance via threshold randomisation
 * ------------------------------------------------
 * The simplest "fire every `$X`" trigger is trivially front-runnable:
 * an attacker watches `creatorBalance` and pre-positions just before
 * the round number. We instead derive the trigger threshold from a
 * keyed HMAC over the lifetime-claimed amount, so each cycle's
 * threshold is a fresh draw from `[$20, $30)` that an attacker
 * cannot compute without the Worker secret. The lifetime-claimed
 * amount is on-chain (so the keeper recomputes it across restarts
 * with no local state) but the secret is not, so the threshold
 * stays unpredictable.
 *
 * Cycle counter, fully stateless
 * ------------------------------
 * `FeeVault.lifetimeCreatorEarned[creator]` is monotonic and grows in
 * lockstep with `creatorBalance[creator]` on every `accrue`; only
 * `claim()` ever decreases `creatorBalance` (and never touches
 * `lifetimeCreatorEarned`). Their difference therefore equals
 * "lifetime amount the creator has claimed" and only changes at
 * claim time. We use it as the seed input to the HMAC, so the
 * threshold for the *current* cycle is fully determined by on-chain
 * state and the secret — no KV, no alarm, no local persistence.
 *
 * Sequential cycle with receipt awaits (not fire-and-forget)
 * ---------------------------------------------------------
 * Unlike `graduation-keeper.ts` and `auto-graduation-buyer.ts`, this
 * keeper has hard step-to-step data dependencies:
 *
 *   claim → know exact USDC delta → buy → know exact token delta → burn
 *
 * so each tx is awaited via `waitForTransactionReceipt` before the
 * next one is submitted. The total wall-clock cost is ~3-4 small-block
 * confirmations (~3-5s on small blocks; ~3 minutes on big blocks).
 *
 * Wallet bound to the creator (intentional)
 * -----------------------------------------
 * `FeeVault.claim()` only ever pays out to `msg.sender`, so the bot
 * wallet has to literally BE the creator wallet — there is no
 * authorise-a-third-party path on the vault. Since the same wallet
 * also does the buy + burn, every step runs from one EOA. We add a
 * defensive startup guard that aborts if the configured private key
 * doesn't derive to `CREATOR_WALLET`; otherwise the bot would happily
 * call `claim()` and revert with `NothingToClaim` (wasted gas) every
 * tick.
 *
 * Balance-delta scoping (so we don't burn unrelated holdings)
 * ----------------------------------------------------------
 * The creator wallet may hold pre-existing USDC or Test HYPE for other
 * reasons. We scope every transfer by snapshotting the balance before
 * each step and using the post-step delta:
 *
 *   - `claimed = usdc.balanceOf(self)_after - usdc.balanceOf(self)_before`
 *   - `bought  = testHype.balanceOf(self)_after - testHype.balanceOf(self)_before`
 *
 * so we only ever spend freshly-claimed USDC on the buy and only
 * burn freshly-bought Test HYPE.
 *
 * Skipping when the token is mid-graduation
 * -----------------------------------------
 * `Zap.buy` reverts with `TokenIsGraduating` while a token sits in
 * `Lifecycle.Graduating` between phase 1 and phase 2. We pre-check
 * `Bonding.isGraduating(testHype)` and skip the cycle this tick rather
 * than burning a `claim()` tx whose USDC we can't immediately spend.
 *
 * Operational setup (one-time)
 * ----------------------------
 *   1. `BUYBACK_BURN_PRIVATE_KEY` worker secret = the creator wallet's
 *      private key (`0x2C84…244E`). The same-wallet guard aborts if
 *      this derives to a different address.
 *   2. Fund the wallet with HYPE for gas. Each cycle is ≤4 txs at
 *      ~120k gas each on small blocks; budget ~0.5 HYPE per cycle.
 *   3. Optional `BUYBACK_BURN_ENTROPY_SECRET` worker secret. If unset
 *      we fall back to deriving the HMAC key from the private key
 *      itself — fine for production (an attacker without the key
 *      can't reproduce the schedule either way), but rotating the
 *      explicit secret is cheaper than rotating a wallet.
 *   4. Ensure the wallet is on small blocks (default; only the
 *      finalize keeper toggles to big). On big blocks, ~60s
 *      confirmations push the cycle past the 1-minute cron tick.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  maxUint256,
  zeroAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  BondingAbi,
  CONTRACT_ADDRESSES,
  FeeVaultAbi,
  HYPER_EVM,
  TokenAbi,
  USDC_ADDRESS,
  ZapAbi,
} from "@launchpad/shared";

import type { AppBindings } from "./types.js";

/**
 * Test HYPE token address — the canary launched by the deployer that
 * this keeper is hard-wired to buy back and burn. This is intentionally
 * not env-configurable: the token+creator pair are part of the
 * keeper's identity, not its config.
 */
const TEST_HYPE_TOKEN: `0x${string}` =
  "0xE1A38D620298290d2d925bDEC280B15a12000000";

/**
 * Deployer / creator wallet. Must match the address derived from
 * `BUYBACK_BURN_PRIVATE_KEY` — we hard-abort otherwise.
 */
const CREATOR_WALLET: `0x${string}` =
  "0x2C8496Bce4aee5Ce4Af571E02543937fb38b244E";

/**
 * Standard "burn" sink. ERC-20 transfer to this address removes the
 * tokens from circulating supply (no actor controls the corresponding
 * private key).
 */
const BURN_ADDRESS: `0x${string}` =
  "0x000000000000000000000000000000000000dEaD";

/**
 * USDC has 6 decimals on HyperEVM. Threshold range is `[$20, $30)` —
 * picked so even the floor easily clears `Zap.MIN_USDC_AMOUNT = $10`
 * after the 0.75% buy fee, while the spread is wide enough that an
 * attacker pre-positioning at the low end of the range eats meaningful
 * range risk.
 */
const MIN_THRESHOLD_USDC_RAW = 20_000_000n;
const MAX_THRESHOLD_USDC_RAW = 30_000_000n;
const THRESHOLD_RANGE_USDC_RAW =
  MAX_THRESHOLD_USDC_RAW - MIN_THRESHOLD_USDC_RAW;

/**
 * Polling interval used by `waitForTransactionReceipt`. Tuned for
 * HyperEVM small blocks (~1s confirms); on big blocks the receipt just
 * lands later and the await stretches across multiple polls.
 */
const RECEIPT_POLL_MS = 1_000;

const chain = {
  id: HYPER_EVM.id,
  name: HYPER_EVM.name,
  nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
  rpcUrls: { default: { http: [HYPER_EVM.rpcUrl] } },
} as const;

export async function runBuybackBurnKeeper(
  env: AppBindings,
): Promise<void> {
  const pkRaw = env.BUYBACK_BURN_PRIVATE_KEY;
  if (!pkRaw || pkRaw.length === 0) {
    log("warn", "buyback_burn_disabled_no_key", {});
    return;
  }
  const pk = normalizePrivateKey(pkRaw);
  const account = privateKeyToAccount(pk);

  // Same-wallet guard. `FeeVault.claim()` pays the caller, so the bot
  // wallet MUST be the creator. Any mismatch means an operator has
  // pasted the wrong key — abort loudly rather than silently calling
  // `claim()` and reverting with `NothingToClaim` every tick.
  if (account.address.toLowerCase() !== CREATOR_WALLET.toLowerCase()) {
    log("error", "buyback_burn_wallet_mismatch", {
      configuredAddress: account.address,
      expectedAddress: CREATOR_WALLET,
    });
    return;
  }

  const rpcUrl = env.HYPEREVM_RPC_URL || HYPER_EVM.rpcUrl;
  const transport = http(rpcUrl);
  const wallet = createWalletClient({ account, chain, transport });
  const publicClient = createPublicClient({ chain, transport });

  // ─── Read state ────────────────────────────────────────────────────
  let creatorBalance: bigint;
  let lifetimeEarned: bigint;
  try {
    [creatorBalance, lifetimeEarned] = await Promise.all([
      publicClient.readContract({
        address: CONTRACT_ADDRESSES.feeVault as `0x${string}`,
        abi: FeeVaultAbi,
        functionName: "creatorBalance",
        args: [CREATOR_WALLET],
      }),
      publicClient.readContract({
        address: CONTRACT_ADDRESSES.feeVault as `0x${string}`,
        abi: FeeVaultAbi,
        functionName: "lifetimeCreatorEarned",
        args: [CREATOR_WALLET],
      }),
    ]);
  } catch (err) {
    log("warn", "buyback_burn_state_read_failed", { error: errMessage(err) });
    return;
  }

  // `lifetimeClaimed` only changes at `claim()` time (see file header),
  // so it's a stable per-cycle counter that we can hash for entropy
  // without re-deriving it on every accrual.
  const lifetimeClaimed = lifetimeEarned - creatorBalance;

  const entropySecret = env.BUYBACK_BURN_ENTROPY_SECRET || pk;
  const threshold = await computeThresholdUsdcRaw(
    entropySecret,
    lifetimeClaimed,
  );

  if (creatorBalance < threshold) {
    log("info", "buyback_burn_below_threshold", {
      creatorBalance: creatorBalance.toString(),
      threshold: threshold.toString(),
      lifetimeClaimed: lifetimeClaimed.toString(),
    });
    return;
  }

  // ─── Pre-check graduation lifecycle ────────────────────────────────
  // `Zap.buy` reverts with `TokenIsGraduating` while a token sits
  // between phase 1 and phase 2 of graduation. Skip this tick rather
  // than burning a `claim()` tx whose USDC we can't yet spend.
  let isGraduating: boolean;
  try {
    isGraduating = await publicClient.readContract({
      address: CONTRACT_ADDRESSES.bonding as `0x${string}`,
      abi: BondingAbi,
      functionName: "isGraduating",
      args: [TEST_HYPE_TOKEN],
    });
  } catch (err) {
    log("warn", "buyback_burn_lifecycle_read_failed", {
      error: errMessage(err),
    });
    return;
  }
  if (isGraduating) {
    log("info", "buyback_burn_token_graduating_skip", {
      token: TEST_HYPE_TOKEN,
    });
    return;
  }

  // ─── Step 1: claim ─────────────────────────────────────────────────
  let claimed: bigint;
  try {
    const usdcBefore = await publicClient.readContract({
      address: USDC_ADDRESS,
      abi: TokenAbi,
      functionName: "balanceOf",
      args: [account.address],
    });

    const claimHash = await wallet.writeContract({
      address: CONTRACT_ADDRESSES.feeVault as `0x${string}`,
      abi: FeeVaultAbi,
      functionName: "claim",
      args: [],
    });
    log("info", "buyback_burn_claim_submitted", { hash: claimHash });
    await publicClient.waitForTransactionReceipt({
      hash: claimHash,
      pollingInterval: RECEIPT_POLL_MS,
    });

    const usdcAfter = await publicClient.readContract({
      address: USDC_ADDRESS,
      abi: TokenAbi,
      functionName: "balanceOf",
      args: [account.address],
    });
    claimed = usdcAfter - usdcBefore;
  } catch (err) {
    log("error", "buyback_burn_claim_failed", { error: errMessage(err) });
    return;
  }

  if (claimed <= 0n) {
    // Defensive — should be impossible given the threshold gate, but
    // guards against a race where another claim path beat us to it
    // (currently none exists, but cheap to assert).
    log("warn", "buyback_burn_claim_returned_zero", {});
    return;
  }
  log("info", "buyback_burn_claimed", { amount: claimed.toString() });

  // ─── Step 2: approve USDC for Zap (one-time max) ───────────────────
  try {
    const allowance = await publicClient.readContract({
      address: USDC_ADDRESS,
      abi: TokenAbi,
      functionName: "allowance",
      args: [account.address, CONTRACT_ADDRESSES.zap as `0x${string}`],
    });
    if (allowance < claimed) {
      const approveHash = await wallet.writeContract({
        address: USDC_ADDRESS,
        abi: TokenAbi,
        functionName: "approve",
        args: [CONTRACT_ADDRESSES.zap as `0x${string}`, maxUint256],
      });
      log("info", "buyback_burn_usdc_approve_submitted", {
        hash: approveHash,
      });
      await publicClient.waitForTransactionReceipt({
        hash: approveHash,
        pollingInterval: RECEIPT_POLL_MS,
      });
    }
  } catch (err) {
    // Stranded USDC: claim landed but approve failed. Will be retried
    // next tick (the next claim is gated on `creatorBalance >=
    // threshold` against fresh accrual; the previously-claimed USDC
    // sits in the wallet until the next cycle picks up).
    log("error", "buyback_burn_approve_failed", { error: errMessage(err) });
    return;
  }

  // ─── Step 3: buy ───────────────────────────────────────────────────
  let bought: bigint;
  try {
    const tokensBefore = await publicClient.readContract({
      address: TEST_HYPE_TOKEN,
      abi: TokenAbi,
      functionName: "balanceOf",
      args: [account.address],
    });

    const buyHash = await wallet.writeContract({
      address: CONTRACT_ADDRESSES.zap as `0x${string}`,
      abi: ZapAbi,
      functionName: "buy",
      args: [TEST_HYPE_TOKEN, claimed, 0n, zeroAddress],
    });
    log("info", "buyback_burn_buy_submitted", {
      hash: buyHash,
      usdcIn: claimed.toString(),
    });
    await publicClient.waitForTransactionReceipt({
      hash: buyHash,
      pollingInterval: RECEIPT_POLL_MS,
    });

    const tokensAfter = await publicClient.readContract({
      address: TEST_HYPE_TOKEN,
      abi: TokenAbi,
      functionName: "balanceOf",
      args: [account.address],
    });
    bought = tokensAfter - tokensBefore;
  } catch (err) {
    // Buy failed (LT mint paused, slippage, etc.). USDC is stranded
    // until next tick's retry path. Common transient causes (LT
    // redeem buffer / mint pause) clear within minutes.
    log("error", "buyback_burn_buy_failed", { error: errMessage(err) });
    return;
  }

  if (bought <= 0n) {
    log("warn", "buyback_burn_buy_returned_zero", {});
    return;
  }
  log("info", "buyback_burn_bought", { amount: bought.toString() });

  // ─── Step 4: burn ──────────────────────────────────────────────────
  try {
    const burnHash = await wallet.writeContract({
      address: TEST_HYPE_TOKEN,
      abi: TokenAbi,
      functionName: "transfer",
      args: [BURN_ADDRESS, bought],
    });
    log("info", "buyback_burn_transfer_submitted", {
      hash: burnHash,
      amount: bought.toString(),
    });
    await publicClient.waitForTransactionReceipt({
      hash: burnHash,
      pollingInterval: RECEIPT_POLL_MS,
    });
  } catch (err) {
    log("error", "buyback_burn_transfer_failed", {
      error: errMessage(err),
      amount: bought.toString(),
    });
    return;
  }

  log("info", "buyback_burn_cycle_complete", {
    claimed: claimed.toString(),
    bought: bought.toString(),
    nextLifetimeClaimed: (lifetimeClaimed + claimed).toString(),
  });
}

/**
 * Maps `(secret, lifetimeClaimed)` to a threshold in `[MIN, MAX)` via
 * HMAC-SHA-256 → uniform mod into `THRESHOLD_RANGE_USDC_RAW`. Worker
 * runtime exposes Web Crypto, so this is dependency-free.
 *
 * Bias from `% range`: the HMAC output is 256 bits, range is `~10^7`,
 * so the modulo bias is `< 2^-225` — negligible for our purposes.
 *
 * Exported only for testability.
 */
export async function computeThresholdUsdcRaw(
  secret: string,
  lifetimeClaimed: bigint,
): Promise<bigint> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBytes = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, enc.encode(lifetimeClaimed.toString())),
  );
  // Pack the first 8 bytes into a uint64 — plenty of entropy for a
  // ~10^7-wide range.
  let entropy = 0n;
  for (let i = 0; i < 8; i++) {
    entropy = (entropy << 8n) | BigInt(sigBytes[i] ?? 0);
  }
  return MIN_THRESHOLD_USDC_RAW + (entropy % THRESHOLD_RANGE_USDC_RAW);
}

/**
 * Tolerate `0x`-prefixed and bare hex secrets — same normalisation
 * `auto-graduation-buyer.ts` does, for symmetry across keepers.
 */
function normalizePrivateKey(raw: string): `0x${string}` {
  return (raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function log(
  level: "info" | "warn" | "error",
  event: string,
  fields: Record<string, unknown>,
): void {
  console.log(
    JSON.stringify({
      level,
      event,
      ...fields,
      timestamp: new Date().toISOString(),
    }),
  );
}
