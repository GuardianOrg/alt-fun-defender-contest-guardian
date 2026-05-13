import type { Conversation } from "@grammyjs/conversations";
import type { Context } from "grammy";

/**
 * Whether `text` is a plain `/cancel` (or bare `cancel`) — the lookup
 * conversations bail out with a "Cancelled." reply on this.
 */
export const isCancel = (text: string): boolean => {
  const lower = text.toLowerCase();
  return lower === "/cancel" || lower === "cancel";
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
