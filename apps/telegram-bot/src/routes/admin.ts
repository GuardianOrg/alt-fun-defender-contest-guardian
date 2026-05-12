import { Hono } from "hono";

import type { AppBindings } from "../lib/types.js";
import { callTelegram } from "../lib/telegram.js";

const admin = new Hono<AppBindings>();

admin.use("*", async (c, next) => {
  const key = c.req.header("x-admin-key");
  if (!key || key !== c.env.ADMIN_API_KEY) {
    return c.text("forbidden", 403);
  }
  await next();
});

/**
 * Point Telegram at this Worker's /webhook route. Run once after deploy
 * and any time TELEGRAM_WEBHOOK_SECRET rotates.
 */
admin.post("/set-webhook", async (c) => {
  const body = await c.req.json<{ url: string }>();
  const res = await callTelegram(c.env.TELEGRAM_BOT_TOKEN, "setWebhook", {
    url: body.url,
    secret_token: c.env.TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ["message"],
  });
  return c.json(await res.json(), res.status as 200);
});

admin.get("/webhook-info", async (c) => {
  const res = await callTelegram(c.env.TELEGRAM_BOT_TOKEN, "getWebhookInfo", {});
  return c.json(await res.json(), res.status as 200);
});

export default admin;
