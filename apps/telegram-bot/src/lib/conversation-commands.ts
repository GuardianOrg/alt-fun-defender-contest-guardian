import type { Conversation } from "@grammyjs/conversations";
import type { Context } from "grammy";

import type { AppContext } from "../bot.js";
import { extractTokenAddress } from "./api.js";
import { showBuyCardForAddress } from "./buy-card.js";
import { sweepWorkflow } from "./workflow-stack-conversation.js";

/**
 * Whether `text` is a plain `/cancel`, the bare `cancel`, or Telegram's
 * addressed form `/cancel@BotUsername` (sent automatically by Telegram
 * clients in group chats). The lookup conversations bail out with a
 * "Cancelled." reply on this.
 */
export const isCancel = (text: string): boolean => {
  const lower = text.toLowerCase();
  return lower === "cancel" || /^\/cancel(?:@\w+)?$/.test(lower);
};

/**
 * Whether `text` starts a slash command other than `/cancel`. The
 * conversations plugin consumes every text message while a conversation
 * is active, so a user typing `/positions` (or any other registered
 * command) mid-lookup would otherwise be parsed as a token address and
 * surface the misleading "Token not found." copy. Detecting the slash
 * here lets the conversation hand control back to the outer middleware
 * via `conversation.halt({ next: true })`, after which grammY's command
 * dispatcher fires the user's intended command.
 */
export const isOtherSlashCommand = (text: string): boolean =>
  !isCancel(text) && /^\/[A-Za-z][\w]{0,31}(?:@\w+)?(?:\s|$)/.test(text);

/**
 * Halt the current conversation and let the outer middleware process
 * the originating update — so a `/positions` typed mid-lookup runs its
 * normal handler instead of getting parsed as a token address.
 */
export const haltAndForward = async <OC extends Context, C extends Context>(
  conversation: Conversation<OC, C>,
): Promise<never> => conversation.halt({ next: true });

/**
 * If `text` contains a contract address (raw `0x…40hex`, an alt.fun URL,
 * or a hyperevmscan token URL — the formats listed on the `/buy` prompt),
 * sweep the current workflow stack and pivot to the buy menu for that
 * token. Returns `true` when the intercept fired so the caller can
 * `return` out of its `waitFor` loop instead of running the prompt's
 * normal validation.
 *
 * Wired into every non-lookup conversation that asks the user for input
 * (custom buy amount, sell percent, withdraw fields, wallet rename, PIN
 * entry, anti-phishing phrase, custom slippage). The three lookup flows
 * (`/buy`, `/sell`, `/track`) already accept an address as their primary
 * input and intentionally do **not** call this — pasting an address mid-
 * `/sell` is the user telling the bot which token to sell, not asking
 * for the buy card. The rewards-wallet wizard also opts out for the
 * same reason: the address there is the user's payout wallet, not a
 * traded token.
 *
 * Issue #821.
 */
export const tryAddressBuyIntercept = async (
  conversation: Conversation<AppContext, AppContext>,
  text: string,
): Promise<boolean> => {
  const addr = extractTokenAddress(text);
  if (!addr) return false;
  await sweepWorkflow(conversation);
  await conversation.external((outerCtx) =>
    showBuyCardForAddress(outerCtx, addr),
  );
  return true;
};
