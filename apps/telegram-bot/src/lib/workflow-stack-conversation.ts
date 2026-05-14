import type { Conversation } from "@grammyjs/conversations";

import type { AppContext } from "../bot.js";
import {
  clearWorkflowMessages,
  pushWorkflowMessage,
} from "./workflow-stack.js";

/**
 * `conversation.external` is the only legal entry point for reads or
 * writes against the live grammY context inside a replay-safe handler;
 * the inline `ctx` is replay-bound and has no `env` / `session` / `api`
 * binding. These two helpers wrap the pattern for the workflow stack
 * so every command using it stays one-liner short rather than
 * repeating the `outer.chat?.id` guard + `external` boilerplate.
 */
export const sweepWorkflow = async (
  conversation: Conversation<AppContext, AppContext>,
): Promise<void> =>
  conversation.external(async (outer) => {
    if (!outer.chat) return;
    await clearWorkflowMessages(outer.session, outer.api, outer.chat.id);
  });

export const trackWorkflowMessage = async (
  conversation: Conversation<AppContext, AppContext>,
  messageId: number,
): Promise<void> =>
  conversation.external((outer) => {
    if (!outer.chat) return;
    pushWorkflowMessage(outer.session, outer.chat.id, messageId);
  });
