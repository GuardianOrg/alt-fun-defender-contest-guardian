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
  let payload: unknown;
  try {
    payload = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("url" in payload) ||
    typeof (payload as { url: unknown }).url !== "string"
  ) {
    return c.json({ error: "url must be a string" }, 400);
  }
  let webhookUrl: URL;
  try {
    webhookUrl = new URL((payload as { url: string }).url);
  } catch {
    return c.json({ error: "invalid_url" }, 400);
  }
  if (webhookUrl.protocol !== "https:") {
    return c.json({ error: "url must use https" }, 400);
  }

  const res = await callTelegram(c.env.TELEGRAM_BOT_TOKEN, "setWebhook", {
    url: webhookUrl.toString(),
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
