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
import { sendStartPromptAfterTrade } from "../commands/start.js";
import { intentKey, type IdempotencyKv } from "./idempotency.js";
import { logger } from "./logger.js";
import { isBenignEditError } from "./nav.js";
import { readProfile } from "./onboarding.js";
import { formatUsdc } from "./format.js";
import { formatToken18, formatUsdc6 } from "./token-card.js";
import {
  clearWorkflowMessages,
  removeWorkflowMessage,
} from "./workflow-stack.js";
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

/**
 * Canonical alt.fun token tracking page for a given contract address.
 * Used to make the ticker on every trade prompt/receipt a clickable
 * link that opens the live token page (same surface the web app and
 * the /track flow link out to).
 */
export const trackingPageUrl = (token: string): string =>
  `https://alt.fun/token/${token}`;

const ZERO_ADDRESS: Hex = "0x0000000000000000000000000000000000000000";

const HEX_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * Read the user's lifetime-attributed referrer wallet from the profile
 * KV record. Written once at first /start (see AGENTS.md "/start →
 * Referrer resolution" and `onboarding.ts:writeProfile`); reads on
 * every trade for lifetime attribution. Returns `ZERO_ADDRESS` when no
 * profile or no referrer is recorded (the common case for users who
 * came in without a `ref_` deeplink). Malformed records are coerced to
 * `ZERO_ADDRESS` so a corrupt record cannot route a referrer cut to a
 * junk address — auditors flagged this as a Major issue (PR #707
 * CodeRabbit review).
 */
export const loadReferrer = async (
  env: AppContext["env"],
  userId: number,
): Promise<Hex> => {
  const profile = await readProfile(env.WALLET_KV, userId);
  const referrer = profile?.referrer;
  if (!referrer) return ZERO_ADDRESS;
  const trimmed = referrer.trim();
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
  | {
      kind: "executed";
      result: ExecutionResult;
      ticker: string;
      side: "buy" | "sell";
      token: string;
    };

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

  return {
    kind: "executed",
    result,
    ticker: intent.ticker,
    side: intent.side,
    token: intent.token,
  };
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
  const { result, ticker, side, token } = outcome;
  if (result.ok) {
    // Receipt-confirmed success — `executeBuy` / `executeSell` only flip
    // `ok` to true after waitForTransactionReceipt returns status=success,
    // so this branch is safe to label "confirmed". A reverted tx never
    // lands here even though sendTransaction returned a hash.
    const verb = side === "buy" ? "Buy" : "Sell";
    // Show the on-chain amount the user actually received, decoded from
    // the BotRouterTrade event. For buys that's tokens; for sells it's
    // the net USDC (gross `usdcAmount` minus the router's `botFee`
    // skim — the post-fee number that actually lands in the user's
    // wallet, mirroring the buy receipt). The line is skipped when the
    // decoded value is missing (router version drift, log-stripping
    // relayer) rather than falling back to the quote — showing a stale
    // pre-trade estimate as "received" would mislead.
    let receivedLine = "";
    if (side === "buy" && result.actualTokensOut !== undefined) {
      receivedLine = `Received: ${formatToken18(result.actualTokensOut)} ${ticker}\n`;
    } else if (side === "sell" && result.actualUsdcOut !== undefined) {
      receivedLine = `Received: $${formatUsdc(result.actualUsdcOut.toString())} USDC\n`;
    }
    // The ticker on the Token line is the clickable jump to the live
    // alt.fun tracking page; the bare contract address sits next to it
    // so the user has both a tap target and a copyable identifier.
    // The receipt bubble itself is deliberately preserved by the
    // caller — see `runWithTxStatusUpdates`, which detaches it from
    // the post-trade workflow sweep before submitting the trade.
    const trackingUrl = trackingPageUrl(token);
    return (
      `✅ <b>${verb} confirmed for ${ticker}</b>\n\n` +
      `${receivedLine}` +
      `Tx: <a href="${explorerTxUrl(result.txHash)}">${result.txHash}</a>\n` +
      `Token: <a href="${trackingUrl}">${ticker}</a> <code>${token}</code>`
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

/**
 * Delay before the `Tx sending` prompt is replaced with the `Tx pending`
 * copy. 20s is long enough that the receipt for a normal HyperEVM block
 * lands first (sub-second blocks; the bulk of the latency is RPC
 * confirmation polling), and short enough that a slow node has updated
 * the user before they wonder if the bot has hung. AGENTS.md cap on
 * receipt-wait is `RECEIPT_TIMEOUT_MS` inside `trade.ts`; the pending
 * copy here is purely advisory until that timeout fires.
 */
export const TX_PENDING_DELAY_MS = 20_000;

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Human-readable description of a staged trade, used to label the
 * Tx-status prompts as the trade progresses through `sending` →
 * `pending` → `result`. For buys we render USDC notional; for sells we
 * render the raw token amount being sold (the user is the seller; the
 * "currency" they are sending is the token itself). Ticker is escaped
 * because token tickers are user-controlled on launch.
 */
export const describeTradeForStatus = (
  side: "buy" | "sell",
  ticker: string,
  amountRaw: bigint,
): string => {
  const ticker_ = escapeHtml(ticker);
  if (side === "buy") {
    return `Buying ${formatUsdc6(amountRaw)} USDC of ${ticker_}`;
  }
  return `Selling ${formatToken18(amountRaw)} ${ticker_}`;
};

export const renderTxSendingText = (description: string): string =>
  `⏳ <b>Tx sending</b>\n${description}`;

export const renderTxPendingText = (description: string): string =>
  `⏳ <b>Tx pending</b>\n${description}\n\n` +
  `Still waiting for the network to confirm — this may take another moment.`;

interface TxStatusEditTarget {
  api: AppContext["api"];
  chatId: number;
  messageId: number;
}

const safeEditStatus = async (
  target: TxStatusEditTarget,
  text: string,
): Promise<void> => {
  try {
    await target.api.editMessageText(target.chatId, target.messageId, text, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
  } catch (err) {
    if (isBenignEditError(err)) return;
    logger.debug("tx status edit failed", { err });
  }
};

export interface RunWithStatusArgs {
  ctx: AppContext;
  /** Bubble to edit through sending → pending → result phases. */
  target: TxStatusEditTarget;
  side: "buy" | "sell";
  /** Pre-formatted "Buying $X USDC of TICKER" / "Selling X TICKER". */
  description: string;
  /** Trade execution to run while the status bubble is shown. */
  run: () => Promise<ConfirmOutcome>;
  /**
   * Override for the `Tx pending` delay. Tests inject `0` to assert the
   * pending edit deterministically without waiting on a real timer.
   */
  pendingDelayMs?: number;
}

/**
 * Drive a single status bubble through `Tx sending` → `Tx pending` (after
 * 20s) → result. Returns the underlying `ConfirmOutcome` so callers can
 * still inspect the trade state. Detaches the target bubble from the
 * workflow stack before `run()` so the post-trade sweep inside
 * `confirmTrade` (which deletes every tracked transient on receipt-
 * confirmed success) does not delete the bubble we are about to replace
 * with the final receipt.
 */
export const runWithTxStatusUpdates = async (
  args: RunWithStatusArgs,
): Promise<ConfirmOutcome> => {
  const delay = args.pendingDelayMs ?? TX_PENDING_DELAY_MS;

  // Phase 1: render "Tx sending" into the target bubble.
  await safeEditStatus(args.target, renderTxSendingText(args.description));

  // Detach so the post-trade sweep leaves this bubble for our final edit.
  removeWorkflowMessage(
    args.ctx.session,
    args.target.chatId,
    args.target.messageId,
  );

  // Wrap mutable state in an object so TS does not narrow the field's
  // type along the linear control-flow path it sees outside the
  // setTimeout closure.
  const state: { settled: boolean; pendingEdit: Promise<void> | null } = {
    settled: false,
    pendingEdit: null,
  };
  const pendingTimer = setTimeout(() => {
    if (state.settled) return;
    state.pendingEdit = safeEditStatus(
      args.target,
      renderTxPendingText(args.description),
    );
  }, delay);

  let outcome: ConfirmOutcome | null = null;
  let runError: unknown = undefined;
  try {
    outcome = await args.run();
  } catch (err) {
    runError = err;
  } finally {
    state.settled = true;
    clearTimeout(pendingTimer);
  }

  // Drain any in-flight pending edit so it cannot land after the final
  // edit and overwrite the receipt with a stale "still pending" view.
  if (state.pendingEdit !== null) {
    await state.pendingEdit.catch(() => {});
  }

  if (outcome !== null) {
    await safeEditStatus(args.target, renderConfirmReply(outcome));
    // After a receipt-confirmed success the post-trade sweep inside
    // `confirmTrade` deletes the originating token-detail card and
    // staging prompt, leaving the receipt as the only visible bubble.
    // Drop a fresh /start view directly underneath so the user has the
    // home menu inline and can chain into the next buy/sell/positions
    // without retyping `/start`. Only fires on `result.ok` — a pending
    // or reverted outcome leaves the user's originating card in place
    // so they can retry from it, and a duplicate home prompt below
    // would just clutter that path.
    if (
      outcome.kind === "executed" &&
      outcome.result.ok
    ) {
      await sendStartPromptAfterTrade(args.ctx, args.target.chatId);
    }
    return outcome;
  }

  // `run()` rejected. Without a terminal edit the user would be stuck
  // on "Tx sending" / "Tx pending" forever — surface a generic failure
  // bubble, then rethrow so upstream loggers / sentry handlers see the
  // original error.
  await safeEditStatus(
    args.target,
    "❌ Transaction failed — please try again in a moment.",
  );
  throw runError;
};
