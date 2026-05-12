import { Hono } from "hono";

import { logger } from "../lib/logger.js";
import type { AppBindings } from "../lib/types.js";

interface IncomingUpdate {
  message?: { chat?: { id?: number } };
  callback_query?: { message?: { chat?: { id?: number } } };
  edited_message?: { chat?: { id?: number } };
}

const extractChatId = (update: IncomingUpdate): number | undefined => {
  return (
    update.message?.chat?.id ??
    update.callback_query?.message?.chat?.id ??
    update.edited_message?.chat?.id
  );
};

const webhook = new Hono<AppBindings>();

/**
 * Telegram delivers updates via POST. The secret token header (set
 * when calling setWebhook) is required so random POSTs from the
 * internet can't forge updates — the bot token alone is not in the
 * request body.
 *
 * Routing: each update is funneled to a `ChatDO` keyed by chat id.
 * The DO runs grammY's `bot.handleUpdate` on its single-threaded
 * event loop, eliminating the WAR hazard the grammY docs warn about
 * for serverless deployments (`session` + `conversations` read-
 * modify-write KV state, and two Worker isolates handling parallel
 * updates for the same chat would otherwise interleave those writes).
 */
webhook.post("/webhook", async (c) => {
  const secret = c.req.header("x-telegram-bot-api-secret-token");
  if (!secret || secret !== c.env.TELEGRAM_WEBHOOK_SECRET) {
    return c.text("forbidden", 403);
  }

  // Always ACK after auth — Telegram aggressively retries 5xx and
  // a parse error would otherwise loop the same update through the
  // worker until it falls off Telegram's retry window.
  let update: IncomingUpdate;
  let rawBody: string;
  try {
    rawBody = await c.req.text();
    update = JSON.parse(rawBody) as IncomingUpdate;
  } catch {
    return c.text("ok");
  }

  const chatId = extractChatId(update);
  if (chatId === undefined) {
    // No chat (e.g. inline_query, channel_post without chat shape).
    // v1 doesn't handle these; ACK so Telegram stops retrying.
    return c.text("ok");
  }

  try {
    const id = c.env.CHAT_DO.idFromName(`chat:${chatId}`);
    const stub = c.env.CHAT_DO.get(id);
    // Fire-and-forget would race the response — we await so the DO has
    // a chance to start `handleUpdate` before the worker tears down.
    // The DO itself never errors back to us (catches everything); a
    // throw here would mean the DO binding itself is broken.
    await stub.fetch("https://chat-do.local/update", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: rawBody,
    });
  } catch (err) {
    logger.error("ChatDO routing failed", { chatId, err });
  }

  return c.text("ok");
});

export default webhook;
