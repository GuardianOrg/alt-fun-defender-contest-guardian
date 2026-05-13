import { logger } from "./logger.js";

/**
 * The bot's multi-step prompt flows (/buy address lookup, /buy custom
 * amount wizard, /withdraw, …) generate a tail of "transient" messages
 * — the bot's prompt and the user's plain-text reply for each step.
 * When the flow ends (cancelled, interrupted by a slash command, or
 * completed) those intermediate prompts become chat clutter that
 * pushes the result message (or the main menu) above the fold.
 *
 * The workflow stack tracks message ids the bot pushed and the user
 * replied with. The grammY session is keyed per user (`session:<userId>`)
 * but a single user can interact with the bot from multiple chats (a
 * private DM and a group). To avoid a sweep in chat A from issuing
 * stale `deleteMessage` calls against ids that belong to chat B, every
 * stored entry carries its own `chatId` and clears filter on it.
 *
 * Appending is O(1); clearing is O(n) and partitions the stack into
 * "this chat's ids" (deleted) and "other chats' ids" (preserved) so
 * concurrent flows in another chat survive untouched.
 */
export interface WorkflowMessageRef {
  chatId: number;
  messageId: number;
}

export interface WorkflowStackSession {
  workflowMessages?: WorkflowMessageRef[];
}

interface TelegramDeleter {
  deleteMessage: (chatId: number, messageId: number) => Promise<unknown>;
}

const ensureArray = (session: WorkflowStackSession): WorkflowMessageRef[] => {
  if (!Array.isArray(session.workflowMessages)) {
    session.workflowMessages = [];
  }
  return session.workflowMessages;
};

/**
 * Append a transient (chat, message) pair to the stack. Caller passes
 * the bot's own reply id after `ctx.reply(...)` and the user's reply id
 * after `conversation.waitFor("message:text")` so both sides of every
 * step are captured. Idempotent — repeat (chatId, messageId) pairs are
 * skipped to avoid wasted `deleteMessage` calls on clear.
 */
export const pushWorkflowMessage = (
  session: WorkflowStackSession,
  chatId: number,
  messageId: number,
): void => {
  const stack = ensureArray(session);
  const dup = stack.some(
    (ref) => ref.chatId === chatId && ref.messageId === messageId,
  );
  if (dup) return;
  stack.push({ chatId, messageId });
};

/** Read the current stack (defensive copy). Exposed for tests + callers
 * that want to inspect the queue without mutating it. */
export const getWorkflowMessages = (
  session: WorkflowStackSession,
): WorkflowMessageRef[] =>
  (session.workflowMessages ?? []).map((ref) => ({ ...ref }));

/**
 * Delete every tracked transient message *for the given chat* and drop
 * those entries from the stack. Entries for other chats are preserved
 * — a concurrent flow in chat B does not get its ids swept by a clear
 * in chat A.
 *
 * Each delete is best-effort: Telegram's `400 message to delete not
 * found` fires when the message is already gone (user wiped it
 * manually) or older than 48h, and we log + swallow. Other errors are
 * also swallowed because the user's intent ("clean up the in-flight
 * flow") is satisfied even if one delete fails — we'd rather not crash
 * the cancel path.
 */
export const clearWorkflowMessages = async (
  session: WorkflowStackSession,
  api: TelegramDeleter,
  chatId: number,
): Promise<void> => {
  const all = session.workflowMessages ?? [];
  if (all.length === 0) {
    session.workflowMessages = [];
    return;
  }
  const toDelete = all.filter((ref) => ref.chatId === chatId);
  session.workflowMessages = all.filter((ref) => ref.chatId !== chatId);
  if (toDelete.length === 0) return;
  await Promise.all(
    toDelete.map((ref) =>
      api.deleteMessage(ref.chatId, ref.messageId).catch((err) => {
        logger.debug("workflow message delete failed", { ref, err });
      }),
    ),
  );
};
