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
 * Point Telegram at this Worker's /webhook route AND publish the slash-menu
 * to Telegram. Run once after deploy and any time TELEGRAM_BOT_TOKEN or
 * TELEGRAM_WEBHOOK_SECRET rotates.
 *
 * Both `setWebhook` and `setMyCommands` are scoped to the bot token, so
 * porting the bot to a fresh BotFather token wipes both registrations.
 * Bundling them here means a single deploy/rotation call rehydrates the
 * full bot surface — `/admin/set-commands` stays separate for the rare
 * case of pushing a BOT_COMMANDS edit without touching the webhook.
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

  const webhookResult = await callTelegramJson(
    c.env.TELEGRAM_BOT_TOKEN,
    "setWebhook",
    {
      url: webhookUrl.toString(),
      secret_token: c.env.TELEGRAM_WEBHOOK_SECRET,
      allowed_updates: ["message", "callback_query"],
    },
  );
  if (!webhookResult.ok) {
    return Response.json(webhookResult.body, { status: webhookResult.status });
  }

  const commandsResult = await callTelegramJson(
    c.env.TELEGRAM_BOT_TOKEN,
    "setMyCommands",
    { commands: BOT_COMMANDS.map((cmd) => ({ ...cmd })) },
  );
  if (!commandsResult.ok) {
    return Response.json(
      {
        error: "set_commands_failed",
        webhook: webhookResult.body,
        commands: commandsResult.body,
      },
      { status: commandsResult.status },
    );
  }

  return Response.json(
    { webhook: webhookResult.body, commands: commandsResult.body },
    { status: 200 },
  );
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
  const result = await callTelegramJson(token, method, payload);
  return Response.json(result.body, { status: result.status });
}

interface TelegramCallResult {
  ok: boolean;
  status: number;
  body: unknown;
}

// Internal variant of proxyTelegram that returns parsed body + status so the
// caller can chain multiple Telegram calls (e.g. setWebhook + setMyCommands)
// and decide whether to short-circuit on partial failure.
async function callTelegramJson(
  token: string,
  method: string,
  payload: Record<string, unknown>,
): Promise<TelegramCallResult> {
  let upstream: Response;
  try {
    upstream = await callTelegram(token, method, payload);
  } catch (err) {
    return {
      ok: false,
      status: 502,
      body: { error: "telegram_unreachable", message: String(err) },
    };
  }
  let body: unknown;
  try {
    body = await upstream.json();
  } catch {
    return {
      ok: false,
      status: 502,
      body: { error: "telegram_invalid_response", status: upstream.status },
    };
  }
  return { ok: upstream.ok, status: upstream.status, body };
}

export default admin;
