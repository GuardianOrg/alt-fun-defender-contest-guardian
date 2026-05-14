import { Hono } from "hono";

import type { AppBindings } from "../lib/types.js";
import { BOT_COMMANDS } from "../lib/bot-commands.js";
import { callTelegram } from "../lib/telegram.js";

const admin = new Hono<AppBindings>();

/**
 * Telegram resolves the slash-menu by walking from the most specific
 * (scope, language) pair to the least specific — most-specific wins.
 * That means a stale entry on any non-default slot shadows the canonical
 * (default, no-language) list this Worker pushes, and the user keeps
 * seeing commands that have already been removed in code. This was the
 * /security menu hangover after `b56a2d91`: setMyCommands at the default
 * slot succeeded on every deploy, but English-locale users still saw the
 * deleted entry because a stale `(default, en)` overlay was sitting on
 * top. Wipe every non-canonical slot a past deploy or BotFather
 * conversation could have plausibly written before publishing the new
 * list. Telegram returns ok:true on deletes even when the slot is empty,
 * so this loop is safe to keep running on every publish.
 *
 * `chat`, `chat_administrators`, `chat_member` are omitted — they
 * require a chat_id we don't track, and we have never set them.
 */
const LEGACY_COMMAND_SLOTS: ReadonlyArray<{
  scope?: { type: string };
  language_code?: string;
}> = [
  { language_code: "en" },
  { scope: { type: "all_private_chats" } },
  { scope: { type: "all_private_chats" }, language_code: "en" },
  { scope: { type: "all_group_chats" } },
  { scope: { type: "all_group_chats" }, language_code: "en" },
  { scope: { type: "all_chat_administrators" } },
  { scope: { type: "all_chat_administrators" }, language_code: "en" },
];

/**
 * Clear stale slots then push BOT_COMMANDS to the default (no-language)
 * slot. Returns the first failure encountered, or the final
 * setMyCommands result on success.
 */
async function publishCommands(
  botToken: string,
): Promise<TelegramCallResult> {
  for (const slot of LEGACY_COMMAND_SLOTS) {
    const payload: Record<string, unknown> = {};
    if (slot.scope) payload.scope = slot.scope;
    if (slot.language_code) payload.language_code = slot.language_code;
    const result = await callTelegramJson(
      botToken,
      "deleteMyCommands",
      payload,
    );
    if (!result.ok) return result;
  }
  return callTelegramJson(botToken, "setMyCommands", {
    commands: BOT_COMMANDS.map((cmd) => ({ ...cmd })),
  });
}

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
    // Telegram API errors arrive as HTTP 200 with `{ ok: false }`, so when
    // callTelegramJson flips ok via the body check we have to manufacture
    // a non-2xx status — bubbling the 200 would tell the deploy script
    // the call succeeded.
    return Response.json(webhookResult.body, {
      status: webhookResult.status >= 400 ? webhookResult.status : 502,
    });
  }

  const commandsResult = await publishCommands(c.env.TELEGRAM_BOT_TOKEN);
  if (!commandsResult.ok) {
    return Response.json(
      {
        error: "set_commands_failed",
        webhook: webhookResult.body,
        commands: commandsResult.body,
      },
      { status: commandsResult.status >= 400 ? commandsResult.status : 502 },
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
 *
 * Wipes legacy scope/language slots first (see `publishCommands`) so a
 * stale entry on a non-default slot can't shadow the canonical list.
 *
 * Telegram signals API-level failures as HTTP 200 with `{ ok: false }`.
 * Forwarding the upstream 200 unchanged would tell deploy scripts the
 * publish succeeded even when nothing landed — manufacture a 502 in
 * that case, matching the `/set-webhook` chain.
 */
admin.post("/set-commands", async (c) => {
  const result = await publishCommands(c.env.TELEGRAM_BOT_TOKEN);
  const status = result.ok
    ? result.status
    : result.status >= 400
      ? result.status
      : 502;
  return Response.json(result.body, { status });
});

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
//
// Telegram signals success via the JSON body's `ok` field, not the HTTP
// status — `setWebhook` against a stale URL or `setMyCommands` with a bad
// description still come back as HTTP 200 with `{ ok: false, error_code,
// description }`. Inspect the body and only return ok=true when both layers
// agree, so callers don't silently chain past an API-level failure.
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
  const apiOk =
    typeof body === "object" &&
    body !== null &&
    "ok" in body &&
    (body as { ok: unknown }).ok === true;
  return {
    ok: upstream.ok && apiOk,
    status: upstream.status,
    body,
  };
}

export default admin;
