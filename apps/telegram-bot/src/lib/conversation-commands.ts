import type { Conversation } from "@grammyjs/conversations";
import type { Context } from "grammy";

import type { AppContext } from "../bot.js";
import { extractTokenAddress } from "./api.js";
import { showBuyCardForAddress } from "./buy-card.js";
import { sweepWorkflow } from "./workflow-stack-conversation.js";

/**
 * Whether `text` starts a slash command. The conversations plugin
 * consumes every text message while a conversation is active, so a
 * user typing `/positions` (or any other registered command) mid-flow
 * would otherwise be parsed as the wizard's expected input (token
 * address, PIN, withdraw amount, etc.) and surface misleading copy.
 * Detecting the slash here lets the conversation hand control back to
 * the outer middleware via `conversation.halt({ next: true })`, after
 * which grammY's command dispatcher fires the user's intended command.
 *
 * There is no `/cancel` command in v1 (replaced by the global Back /
 * Home nav row built in `lib/nav.ts`), so typing `/cancel` just halts
 * the conversation like any other unrecognised slash.
 */
export const isOtherSlashCommand = (text: string): boolean =>
  /^\/[A-Za-z][\w]{0,31}(?:@\w+)?(?:\s|$)/.test(text);

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
    // `forceFreshPlacement` skips the prior-buy-card reuse path: the
    // stored `lastBuyCardMessageByChat` slot often sits far upstream
    // from where the user is currently typing (a stale standalone
    // paste). Editing it leaves the wizard with deleted prompt + paste
    // and no visible response near the cursor — see the placement-
    // option doc on `showBuyCardForAddress` for the full rationale.
    showBuyCardForAddress(outerCtx, addr, { forceFreshPlacement: true }),
  );
  return true;
};
