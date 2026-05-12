import { Hono } from "hono";

import type { AppBindings } from "../lib/types.js";
import { type TelegramUpdate, sendMessage } from "../lib/telegram.js";
import { parseCommand } from "../lib/commands.js";
import { handlePositions } from "../commands/positions.js";
import { handleWallet } from "../commands/wallet.js";
import {
  callbackHandlers,
  dispatchCallback,
} from "../lib/callbacks.js";
import { logger } from "../lib/logger.js";

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

  // Always ACK after auth — Telegram aggressively retries 5xx and a parse
  // error or transient sendMessage failure would otherwise loop the same
  // update through the worker until it falls off Telegram's retry window.
  let update: TelegramUpdate;
  try {
    update = await c.req.json<TelegramUpdate>();
  } catch {
    return c.text("ok");
  }

  if (update.callback_query) {
    try {
      await dispatchCallback(
        c.env,
        update.callback_query,
        callbackHandlers,
      );
    } catch (err) {
      // dispatchCallback already swallows handler/Telegram errors,
      // but a registry-level bug or programmer error in future
      // handlers must still leave the webhook 200ing.
      logger.error("dispatchCallback failed", {
        queryId: update.callback_query.id,
        err,
      });
    }
    return c.text("ok");
  }

  const msg = update.message;
  if (!msg) return c.text("ok");

  const cmd = parseCommand(msg);
  if (cmd?.name === "start") {
    const name = msg.from?.first_name ?? "there";
    try {
      await sendMessage(
        c.env.TELEGRAM_BOT_TOKEN,
        msg.chat.id,
        `Hi ${name}! Alt Fun bot is online. End-to-end check OK.`,
      );
    } catch (err) {
      logger.error("sendMessage failed", { command: "start", err });
    }
  } else if (cmd?.name === "positions") {
    try {
      await handlePositions(c.env, msg.chat.id, cmd.args);
    } catch (err) {
      logger.error("handlePositions failed", { err });
    }
  } else if (cmd?.name === "wallet") {
    try {
      await handleWallet(c.env, msg.chat.id);
    } catch (err) {
      logger.error("handleWallet failed", { err });
    }
  }

  return c.text("ok");
});

export default webhook;
