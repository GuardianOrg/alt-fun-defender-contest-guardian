/**
 * Command-level trade execution helpers.
 *
 * Bridges the `/buy` and `/sell` callback handlers to `lib/trade.ts`:
 *   - stages a pending intent in `ctx.session.pendingTrade` so the next
 *     Confirm button knows what to submit;
 *   - decrypts the active wallet's private key on confirm, calls
 *     `executeBuy` / `executeSell`, and formats the user-facing reply
 *     (pending → tx hash + explorer link, or a readable revert message).
 *
 * The split exists so the command files stay focused on Telegram UX and
 * the on-chain primitives in `trade.ts` stay free of grammY types.
 */

import type { AppContext } from "../bot.js";
import { intentKey, type IdempotencyKv } from "./idempotency.js";
import { logger } from "./logger.js";
import { formatToken18 } from "./token-card.js";
import { clearWorkflowMessages } from "./workflow-stack.js";
import {
  executeBuy,
  executeSell,
  explorerTxUrl,
  renderExecutionError,
  type ExecutionResult,
  type Hex,
  type IdempotencyBinding,
} from "./trade.js";
import { WalletManager } from "./wallet.js";

/** How long a staged trade intent stays valid before the Confirm becomes a no-op. */
export const CONFIRM_WINDOW_MS = 60_000;

const ZERO_ADDRESS: Hex = "0x0000000000000000000000000000000000000000";

/** KV key holding the lifetime referrer wallet for a Telegram user. */
const referrerKey = (userId: number): string => `referrer:${userId}`;

const HEX_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * Read the user's lifetime-attributed referrer wallet from KV. Written
 * once at /start when the user lands via a `ref_` deeplink (see AGENTS.md
 * "/start → Referrer resolution"); reads on every trade for lifetime
 * attribution. Returns `ZERO_ADDRESS` when no referrer is recorded (the
 * common case for users who came in without a deeplink). Malformed KV
 * values are also coerced to `ZERO_ADDRESS` so a corrupt record cannot
 * route a referrer cut to a junk address — auditors flagged this as a
 * Major issue (PR #707 CodeRabbit review).
 */
export const loadReferrer = async (
  env: AppContext["env"],
  userId: number,
): Promise<Hex> => {
  const raw = await env.WALLET_KV.get(referrerKey(userId));
  if (raw === null) return ZERO_ADDRESS;
  const trimmed = raw.trim();
  return HEX_ADDRESS_RE.test(trimmed) ? (trimmed as Hex) : ZERO_ADDRESS;
};

/** Short opaque nonce so a stale `cnf:` callback can be detected. */
const newNonce = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
};

interface StageBuyArgs {
  ctx: AppContext;
  token: string;
  ticker: string;
  /** USDC notional raw (6dp). */
  usdcRaw: bigint;
}

interface StageSellArgs {
  ctx: AppContext;
  token: string;
  ticker: string;
  /** Token amount raw (18dp). */
  tokenRaw: bigint;
}

interface StagedIntent {
  nonce: string;
  expiresAt: number;
}

/**
 * Stage a buy intent in the session. Returns the nonce so the caller
 * can mint the matching `cnf:<nonce>` callback button.
 */
export const stageBuy = (args: StageBuyArgs): StagedIntent => {
  const nonce = newNonce();
  const expiresAt = Date.now() + CONFIRM_WINDOW_MS;
  args.ctx.session.pendingTrade = {
    side: "buy",
    token: args.token,
    amountRaw: args.usdcRaw.toString(),
    ticker: args.ticker,
    nonce,
    expiresAt,
  };
  return { nonce, expiresAt };
};

export const stageSell = (args: StageSellArgs): StagedIntent => {
  const nonce = newNonce();
  const expiresAt = Date.now() + CONFIRM_WINDOW_MS;
  args.ctx.session.pendingTrade = {
    side: "sell",
    token: args.token,
    amountRaw: args.tokenRaw.toString(),
    ticker: args.ticker,
    nonce,
    expiresAt,
  };
  return { nonce, expiresAt };
};

/** Build the [Confirm | Cancel] inline keyboard for a staged trade. */
export const confirmKeyboard = (
  nonce: string,
): Array<Array<{ text: string; callback_data: string }>> => [
  [
    { text: "✅ Confirm", callback_data: `cnf:${nonce}` },
    { text: "✖ Cancel", callback_data: `ccl:${nonce}` },
  ],
];

/**
 * Run the staged intent on confirm. Returns a structured result so the
 * caller can pick the right Telegram method (edit message vs new reply).
 *
 * The flow:
 *   1. Validate nonce + expiry against `ctx.session.pendingTrade`. Stale
 *      or missing → no-op result so the caller can render a polite
 *      "expired" message.
 *   2. Decrypt the active wallet's private key.
 *   3. Call `executeBuy` / `executeSell`.
 *   4. Clear `pendingTrade` regardless of outcome — a single intent can
 *      only fire once.
 */
export type ConfirmOutcome =
  | { kind: "expired" }
  | { kind: "no_wallet" }
  | { kind: "executed"; result: ExecutionResult; ticker: string; side: "buy" | "sell" };

export const confirmTrade = async (
  ctx: AppContext,
  nonce: string,
): Promise<ConfirmOutcome> => {
  const intent = ctx.session.pendingTrade;
  if (!intent || intent.nonce !== nonce || intent.expiresAt < Date.now()) {
    return { kind: "expired" };
  }
  // Clear the slot up front so a duplicate Confirm tap cannot replay
  // the same intent even if the second invocation lands before the
  // first one's session write commits.
  ctx.session.pendingTrade = undefined;

  if (!ctx.from) return { kind: "expired" };

  const wm = new WalletManager(ctx.env.WALLET_KV, ctx.env.MASTER_KEY);
  const active = await wm.getActive(ctx.from.id);
  if (!active) return { kind: "no_wallet" };

  const privateKey = await wm.decrypt(active.encryptedKey, ctx.from.id);
  const slippageBps = ctx.session.slippageBps;
  const trader = active.address as Hex;
  const token = intent.token as Hex;
  const amount = BigInt(intent.amountRaw);
  const referrer = await loadReferrer(ctx.env, ctx.from.id);

  // Persistent commit-log keyed on (userId, nonce). The in-memory clear
  // of `pendingTrade` above protects against a duplicate Confirm tap
  // within a single DO turn; this protects against the harder case of
  // Telegram retrying the webhook before grammY's session write commits
  // to KV (slow `sendTransaction`, Worker CPU-killed mid-flight). On the
  // retry, executeBuy/executeSell see the existing record and return
  // the prior outcome instead of submitting a second on-chain tx.
  const idempotency: IdempotencyBinding = {
    kv: ctx.env.WALLET_KV as unknown as IdempotencyKv,
    key: intentKey(ctx.from.id, intent.nonce),
  };

  const result =
    intent.side === "buy"
      ? await executeBuy(ctx.env, {
          token,
          usdcAmount: amount,
          trader,
          privateKey,
          slippageBps,
          referrer,
          idempotency,
        })
      : await executeSell(ctx.env, {
          token,
          tokenAmount: amount,
          trader,
          privateKey,
          slippageBps,
          referrer,
          idempotency,
        });

  // Best-effort sweep of every transient message tracked on the
  // workflow stack for this chat (token-detail card + "Ready to…"
  // staging prompt + any leftover wizard prompts). Once the trade has
  // committed on-chain, all of those views are stale and clutter the
  // chat above the receipt. Only fires on receipt-confirmed success —
  // a `pending` (still in mempool) or `failed` outcome means the user
  // may want to retry from the same card, so we leave the stack
  // intact. `clearWorkflowMessages` is already per-chat scoped and
  // swallows `message not found` errors (already deleted, >48h old).
  if (result?.ok && ctx.chat) {
    try {
      await clearWorkflowMessages(ctx.session, ctx.api, ctx.chat.id);
    } catch (err) {
      logger.debug("post-trade workflow sweep failed", { err });
    }
  }

  return { kind: "executed", result, ticker: intent.ticker, side: intent.side };
};

/**
 * Render a user-facing reply for the confirm outcome. Tests assert on
 * pieces of this copy (tx hash, error words), so keep the strings
 * descriptive rather than emoji-coded.
 */
export const renderConfirmReply = (outcome: ConfirmOutcome): string => {
  if (outcome.kind === "expired") {
    return "⏱ That trade confirmation has expired. Re-run /buy or /sell to try again.";
  }
  if (outcome.kind === "no_wallet") {
    return "No active wallet — run /wallet to set one up.";
  }
  const { result, ticker, side } = outcome;
  if (result.ok) {
    // Receipt-confirmed success — `executeBuy` / `executeSell` only flip
    // `ok` to true after waitForTransactionReceipt returns status=success,
    // so this branch is safe to label "confirmed". A reverted tx never
    // lands here even though sendTransaction returned a hash.
    const verb = side === "buy" ? "Buy" : "Sell";
    // For buys, show the on-chain tokens received (decoded from the
    // BotRouterTrade event) instead of just the tx hash. The line is
    // skipped when actualTokensOut is missing (router version drift,
    // log-stripping relayer) rather than falling back to the quote —
    // showing a stale pre-trade estimate as "received" would mislead.
    const receivedLine =
      side === "buy" && result.actualTokensOut !== undefined
        ? `Received: ${formatToken18(result.actualTokensOut)} ${ticker}\n`
        : "";
    return (
      `✅ <b>${verb} confirmed for ${ticker}</b>\n\n` +
      `${receivedLine}` +
      `Tx: <a href="${explorerTxUrl(result.txHash)}">${result.txHash}</a>`
    );
  }
  // `pending` is not a failure — the tx is in the mempool and may still
  // mine. Render with ⏳ so users don't read it as a revert. ❌ stays
  // reserved for outcomes the chain has definitively rejected or where
  // no tx ever landed.
  const prefix = result.kind === "pending" ? "⏳" : "❌";
  return `${prefix} ${renderExecutionError(result)}`;
};

/**
 * Degen-mode entry point: stage the intent and immediately confirm it in
 * the same call, skipping the inline `[Confirm]` / `[Cancel]` keyboard.
 *
 * Routes through the same `stageBuy` → `confirmTrade` plumbing as the
 * button-driven flow so the slippage bound, referrer attribution, and
 * pending-slot bookkeeping stay identical — only the user-facing confirm
 * step is removed. PIN gates and other auth checks remain untouched per
 * AGENTS.md `/settings → Degen mode` ("PIN gates stay active regardless
 * of degen mode — toggling this never bypasses authentication").
 */
export const submitBuy = async (
  args: StageBuyArgs,
): Promise<ConfirmOutcome> => {
  const { nonce } = stageBuy(args);
  return confirmTrade(args.ctx, nonce);
};

export const submitSell = async (
  args: StageSellArgs,
): Promise<ConfirmOutcome> => {
  const { nonce } = stageSell(args);
  return confirmTrade(args.ctx, nonce);
};

/** Cancel callback handler shared by /buy and /sell. */
export const cancelTrade = (ctx: AppContext, nonce: string): boolean => {
  const intent = ctx.session.pendingTrade;
  if (!intent || intent.nonce !== nonce) return false;
  ctx.session.pendingTrade = undefined;
  return true;
};
