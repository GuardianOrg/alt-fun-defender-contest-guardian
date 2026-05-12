import type { DurableObjectState } from "@cloudflare/workers-types";

import { createBot } from "./bot.js";
import { logger } from "./lib/logger.js";
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
 * The DO holds no persistent state of its own — it's pure serialisation
 * infrastructure. All durable data still lives in KV; the DO is a
 * single-threaded gateway in front of it.
 */
export class ChatDO {
  constructor(
    _state: DurableObjectState,
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
      const bot = createBot(this.env);
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
}
