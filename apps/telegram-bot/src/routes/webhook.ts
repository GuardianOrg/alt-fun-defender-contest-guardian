import { Hono } from "hono";

import type { AppBindings } from "../lib/types.js";
import {
  type TelegramUpdate,
  sendMessage,
} from "../lib/telegram.js";
import { parseCommand } from "../lib/commands.js";

const webhook = new Hono<AppBindings>();

/**
 * Telegram delivers updates via POST. We require the secret token header
 * (set when calling setWebhook) so random POSTs from the internet can't
 * forge updates — the bot token alone is not in the request body.
 */
webhook.post("/webhook", async (c) => {
  const secret = c.req.header("x-telegram-bot-api-secret-token");
  if (!secret || secret !== c.env.TELEGRAM_WEBHOOK_SECRET) {
    return c.text("forbidden", 403);
  }

  const update = (await c.req.json()) as TelegramUpdate;
  const msg = update.message;
  if (!msg) return c.text("ok");

  const cmd = parseCommand(msg);
  if (cmd?.name === "start") {
    const name = msg.from?.first_name ?? "there";
    await sendMessage(
      c.env.TELEGRAM_BOT_TOKEN,
      msg.chat.id,
      `Hi ${name}! Alt Fun bot is online. End-to-end check OK.`,
    );
  }

  return c.text("ok");
});

export default webhook;
