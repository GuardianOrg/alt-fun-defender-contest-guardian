import { Hono } from "hono";

import type { AppBindings } from "../lib/types.js";
import { BOT_COMMANDS } from "../lib/bot-commands.js";
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

  return proxyTelegram(c.env.TELEGRAM_BOT_TOKEN, "setWebhook", {
    url: webhookUrl.toString(),
    secret_token: c.env.TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ["message", "callback_query"],
  });
});

admin.get("/webhook-info", async (c) =>
  proxyTelegram(c.env.TELEGRAM_BOT_TOKEN, "getWebhookInfo", {}),
);

/**
 * Publish the slash-menu (BOT_COMMANDS) to Telegram. Telegram caches the
 * list per bot, so run once after deploy and whenever BOT_COMMANDS
 * changes — handlers do not need to re-push on every webhook.
 */
admin.post("/set-commands", async (c) =>
  proxyTelegram(c.env.TELEGRAM_BOT_TOKEN, "setMyCommands", {
    commands: BOT_COMMANDS.map((c) => ({ ...c })),
  }),
);

// Centralise Telegram-side failures so the admin routes return a deterministic
// 502 instead of a generic 500 when the upstream is down or returns junk JSON.
async function proxyTelegram(
  token: string,
  method: string,
  payload: Record<string, unknown>,
): Promise<Response> {
  let upstream: Response;
  try {
    upstream = await callTelegram(token, method, payload);
  } catch (err) {
    return Response.json(
      { error: "telegram_unreachable", message: String(err) },
      { status: 502 },
    );
  }
  let body: unknown;
  try {
    body = await upstream.json();
  } catch {
    return Response.json(
      { error: "telegram_invalid_response", status: upstream.status },
      { status: 502 },
    );
  }
  return Response.json(body, { status: upstream.status });
}

export default admin;
