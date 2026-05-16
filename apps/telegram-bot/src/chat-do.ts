import type { DurableObjectState } from "@cloudflare/workers-types";

import { createBot } from "./bot.js";
import { logger } from "./lib/logger.js";
import { processPendingTxAlarm } from "./lib/pending-tx-poller.js";
import type { Env } from "./lib/types.js";

/**
 * One Durable Object instance per Telegram chat. The webhook router
 * computes `idFromName(\`chat:${chatId}\`)` and fans every update for
 * that chat through this DO, which serialises updates on the DO's
 * single-threaded event loop.
 *
 * Why this exists: grammY's session + conversations plugins read-modify-
 * write KV-backed state. On webhook serverless, Telegram sends update N+1
 * the instant we ACK update N — two Worker isolates can interleave a
 * read-modify-write and lose data (the WAR hazard the grammY docs warn
 * about). The DO has at-most-one-in-flight semantics per chat, so the
 * read-modify-write becomes atomic from the bot's perspective.
 *
 * The DO also owns the pending-tx alarm queue: when a trade returns
 * `kind: "pending"` from `awaitReceipt`, the handler persists the tx
 * details in this DO's storage and sets an alarm so the receipt is
 * re-polled in the background until the chain settles it. See
 * `lib/pending-tx-poller.ts` for the polling loop.
 */
export class ChatDO {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    let update: unknown;
    try {
      update = await request.json();
    } catch (err) {
      logger.error("ChatDO got non-JSON body", { err });
      return new Response("ok");
    }

    try {
      const bot = createBot(this.env, { doState: this.state });
      // Cast to grammY's update type — webhook router validates the
      // chat_id presence before routing here, but the full Update
      // shape is grammY's contract to enforce inside handleUpdate.
      await bot.handleUpdate(update as Parameters<typeof bot.handleUpdate>[0]);
    } catch (err) {
      // grammY's catch handler re-throws by design; we swallow at the
      // DO boundary so the webhook always ACKs 200 (Telegram retry-storm
      // rule). The error has already been logged at the bot layer.
      logger.error("bot.handleUpdate failed inside ChatDO", { err });
    }

    return new Response("ok");
  }

  /**
   * Alarm fires when at least one pending tx is waiting on a receipt
   * (set by `schedulePendingTxPoll`). The handler re-polls every
   * entry, edits the corresponding bubble when the receipt lands, and
   * reschedules itself until the queue is empty or each entry has
   * exceeded its max-poll window. See `lib/pending-tx-poller.ts`.
   */
  async alarm(): Promise<void> {
    try {
      await processPendingTxAlarm(this.env, this.state.storage);
    } catch (err) {
      logger.error("pendingTx alarm failed", { err });
    }
  }
}
