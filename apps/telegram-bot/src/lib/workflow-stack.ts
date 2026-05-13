import { logger } from "./logger.js";

/**
 * The bot's multi-step prompt flows (/buy address lookup, /buy custom
 * amount wizard, /withdraw, …) generate a tail of "transient" messages
 * — the bot's prompt and the user's plain-text reply for each step.
 * When the flow ends (cancelled, interrupted by a slash command, or
 * completed) those intermediate prompts become chat clutter that
 * pushes the result message (or the main menu) above the fold.
 *
 * The workflow stack tracks the message ids the bot pushed and the
 * user replied with, scoped per session, so a flow can sweep its own
 * transient prompts on exit. The stack lives on the grammY session so
 * it survives the stateless per-update Worker lifecycle without a
 * second KV namespace.
 *
 * The list ordering does not matter for deletion (Telegram returns
 * `400 message to delete not found` for already-deleted ids and we
 * swallow it), but appending is O(1) which keeps push hot-paths cheap.
 */
export interface WorkflowStackSession {
  workflowMessages?: number[];
}

interface TelegramDeleter {
  deleteMessage: (chatId: number, messageId: number) => Promise<unknown>;
}

const ensureArray = (session: WorkflowStackSession): number[] => {
  if (!Array.isArray(session.workflowMessages)) {
    session.workflowMessages = [];
  }
  return session.workflowMessages;
};

/**
 * Append a transient message id to the stack. Caller passes the bot's
 * own reply id after `ctx.reply(...)` and the user's reply id after
 * `conversation.waitFor("message:text")` so both sides of every step
 * are captured. Idempotent — repeat ids are skipped to avoid wasted
 * `deleteMessage` calls on clear.
 */
export const pushWorkflowMessage = (
  session: WorkflowStackSession,
  messageId: number,
): void => {
  const stack = ensureArray(session);
  if (stack.includes(messageId)) return;
  stack.push(messageId);
};

/** Read the current stack (defensive copy). Exposed for tests + callers
 * that want to inspect the queue without mutating it. */
export const getWorkflowMessages = (
  session: WorkflowStackSession,
): number[] => [...(session.workflowMessages ?? [])];

/**
 * Delete every tracked transient message and reset the stack. Each
 * delete is best-effort: Telegram's `400 message to delete not found`
 * fires when the message is already gone (user wiped it manually) or
 * older than 48h, and we log + swallow. A non-benign error is also
 * swallowed because the user's intent ("clean up the in-flight flow")
 * is satisfied even if one delete fails — and we'd rather not crash
 * the cancel path.
 */
export const clearWorkflowMessages = async (
  session: WorkflowStackSession,
  api: TelegramDeleter,
  chatId: number,
): Promise<void> => {
  const ids = session.workflowMessages ?? [];
  session.workflowMessages = [];
  if (ids.length === 0) return;
  await Promise.all(
    ids.map((id) =>
      api.deleteMessage(chatId, id).catch((err) => {
        logger.debug("workflow message delete failed", { id, err });
      }),
    ),
  );
};
