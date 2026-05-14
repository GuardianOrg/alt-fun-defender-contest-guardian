import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import app from "../index.js";
import { BOT_COMMANDS } from "../lib/bot-commands.js";
import { makeTestEnv } from "./helpers/env.js";

// Vite/vitest-only glob import: pulls every commands/*.ts as raw source
// at test time. Avoids `node:fs` (this app's tsconfig excludes node
// types since it targets Cloudflare Workers). The local type assertion
// keeps `vite/client` types out of the worker tsconfig.
interface ViteImportMeta {
  glob: (
    pattern: string,
    options: { query: string; import: string; eager: boolean },
  ) => Record<string, string>;
}
const COMMAND_SOURCES = (import.meta as unknown as ViteImportMeta).glob(
  "../commands/*.ts",
  { query: "?raw", import: "default", eager: true },
);

const env = makeTestEnv();

const post = (body: string | object, headers: Record<string, string> = {}) =>
  app.request(
    "/admin/set-webhook",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-admin-key": "test-admin-key",
        ...headers,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    },
    env,
  );

// Mirrors LEGACY_COMMAND_SLOTS in routes/admin.ts — these slots are
// wiped with deleteMyCommands before BOT_COMMANDS is published, so
// stale per-language / per-scope entries can't shadow the canonical
// (default, no-language) menu. The /security hangover after b56a2d91
// is the regression this guards against.
const LEGACY_COMMAND_SLOT_PAYLOADS: ReadonlyArray<Record<string, unknown>> = [
  { language_code: "en" },
  { scope: { type: "all_private_chats" } },
  { scope: { type: "all_private_chats" }, language_code: "en" },
  { scope: { type: "all_group_chats" } },
  { scope: { type: "all_group_chats" }, language_code: "en" },
  { scope: { type: "all_chat_administrators" } },
  { scope: { type: "all_chat_administrators" }, language_code: "en" },
];

// One setWebhook + N deleteMyCommands + one setMyCommands.
const SET_WEBHOOK_FETCH_COUNT = 1 + LEGACY_COMMAND_SLOT_PAYLOADS.length + 1;
// N deleteMyCommands + one setMyCommands.
const PUBLISH_COMMANDS_FETCH_COUNT = LEGACY_COMMAND_SLOT_PAYLOADS.length + 1;

describe("POST /admin/set-webhook", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Use mockImplementation so every call gets a fresh Response — a
    // single Response's body can only be read once, and set-webhook
    // makes many upstream calls (setWebhook + deleteMyCommands ×N +
    // setMyCommands).
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({ ok: true, result: true }), {
            status: 200,
          }),
        ),
      );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("rejects requests missing the admin key", async () => {
    const res = await post(
      { url: "https://example.com/webhook" },
      { "x-admin-key": "" },
    );
    expect(res.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("400s on malformed JSON without calling Telegram", async () => {
    const res = await post("not json");
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("400s when url is missing", async () => {
    const res = await post({});
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("400s when url is not a string", async () => {
    const res = await post({ url: 123 });
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("400s on unparseable url", async () => {
    const res = await post({ url: "not a url" });
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("400s on non-https url (Telegram requires https)", async () => {
    const res = await post({ url: "http://example.com/webhook" });
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("502s when Telegram fetch throws (network failure)", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const res = await post({ url: "https://example.com/webhook" });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("telegram_unreachable");
  });

  it("502s when Telegram returns non-JSON body", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response("<html>bad gateway</html>", { status: 502 }),
    );
    const res = await post({ url: "https://example.com/webhook" });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("telegram_invalid_response");
  });

  it("forwards valid https url to Telegram with secret_token", async () => {
    const res = await post({ url: "https://example.com/webhook" });
    expect(res.status).toBe(200);
    // setWebhook + deleteMyCommands (per legacy slot) + setMyCommands.
    expect(fetchSpy).toHaveBeenCalledTimes(SET_WEBHOOK_FETCH_COUNT);
    const [webhookUrl, webhookInit] = fetchSpy.mock.calls[0]!;
    expect(webhookUrl).toBe(
      "https://api.telegram.org/bottest-bot-token/setWebhook",
    );
    const webhookBody = JSON.parse(
      (webhookInit as RequestInit).body as string,
    );
    expect(webhookBody.url).toBe("https://example.com/webhook");
    expect(webhookBody.secret_token).toBe("test-secret");
    expect(webhookBody.allowed_updates).toEqual([
      "message",
      "callback_query",
    ]);
  });

  it("also publishes BOT_COMMANDS so a fresh bot token gets its slash menu", async () => {
    const res = await post({ url: "https://example.com/webhook" });
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(SET_WEBHOOK_FETCH_COUNT);
    const [commandsUrl, commandsInit] =
      fetchSpy.mock.calls[SET_WEBHOOK_FETCH_COUNT - 1]!;
    expect(commandsUrl).toBe(
      "https://api.telegram.org/bottest-bot-token/setMyCommands",
    );
    const commandsBody = JSON.parse(
      (commandsInit as RequestInit).body as string,
    ) as { commands: Array<{ command: string; description: string }> };
    expect(commandsBody.commands).toEqual(
      BOT_COMMANDS.map((c) => ({
        command: c.command,
        description: c.description,
      })),
    );
  });

  it("clears legacy scope/language slots before publishing to default", async () => {
    const res = await post({ url: "https://example.com/webhook" });
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(SET_WEBHOOK_FETCH_COUNT);
    // Skip the leading setWebhook; the rest of the calls are the
    // delete sweep followed by the final setMyCommands.
    const deleteCalls = fetchSpy.mock.calls.slice(
      1,
      1 + LEGACY_COMMAND_SLOT_PAYLOADS.length,
    );
    for (const [url, init] of deleteCalls) {
      expect(url).toBe(
        "https://api.telegram.org/bottest-bot-token/deleteMyCommands",
      );
      // Must POST so Telegram interprets the body — a GET silently no-ops.
      expect((init as RequestInit).method).toBe("POST");
    }
    const observedPayloads = deleteCalls.map((call: unknown[]) =>
      JSON.parse((call[1] as RequestInit).body as string),
    );
    expect(observedPayloads).toEqual(LEGACY_COMMAND_SLOT_PAYLOADS);
  });

  it("fails if a legacy-slot delete fails (won't ship a half-cleared menu)", async () => {
    // First call (setWebhook) succeeds, second call (first delete) fails.
    fetchSpy
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, result: true }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: false,
            error_code: 400,
            description: "Bad Request",
          }),
          { status: 200 },
        ),
      );
    const res = await post({ url: "https://example.com/webhook" });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("set_commands_failed");
    // setWebhook + the failed delete only — no further deletes and no
    // setMyCommands once the cleanup chain breaks.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  // Telegram returns HTTP 200 with `{ ok: false, error_code, description }`
  // for API-level errors (bad token, malformed payload, etc.). The handler
  // must treat that as a failure even though the HTTP layer says success.
  it("surfaces setMyCommands failure without claiming success", async () => {
    // setWebhook + every delete succeed; the final setMyCommands fails.
    const okResponse = () =>
      new Response(JSON.stringify({ ok: true, result: true }), {
        status: 200,
      });
    fetchSpy.mockResolvedValueOnce(okResponse()); // setWebhook
    for (let i = 0; i < LEGACY_COMMAND_SLOT_PAYLOADS.length; i++) {
      fetchSpy.mockResolvedValueOnce(okResponse());
    }
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: false,
          error_code: 400,
          description: "Bad Request",
        }),
        { status: 200 },
      ),
    );
    const res = await post({ url: "https://example.com/webhook" });
    // 200-with-ok:false must NOT propagate as 200 — the deploy script
    // depends on the status to detect a failed publish.
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("set_commands_failed");
  });

  it("does not call setMyCommands when setWebhook fails", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: false,
          error_code: 401,
          description: "Unauthorized",
        }),
        { status: 200 },
      ),
    );
    const res = await post({ url: "https://example.com/webhook" });
    expect(res.status).toBe(502);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe("GET /admin/webhook-info", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: true,
            result: { url: "https://example.com/webhook", pending_update_count: 0 },
          }),
          { status: 200 },
        ),
      );
  });
  afterEach(() => fetchSpy.mockRestore());

  const get = (headers: Record<string, string> = {}) =>
    app.request(
      "/admin/webhook-info",
      { method: "GET", headers: { "x-admin-key": "test-admin-key", ...headers } },
      env,
    );

  it("rejects requests missing the admin key", async () => {
    const res = await get({ "x-admin-key": "" });
    expect(res.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("proxies the getWebhookInfo result", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url] = fetchSpy.mock.calls[0]!;
    expect(url).toBe(
      "https://api.telegram.org/bottest-bot-token/getWebhookInfo",
    );
    const body = (await res.json()) as {
      ok: boolean;
      result: { url: string };
    };
    expect(body.result.url).toBe("https://example.com/webhook");
  });

  it("502s when Telegram is unreachable", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("ETIMEDOUT"));
    const res = await get();
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("telegram_unreachable");
  });

  it("502s when Telegram returns non-JSON body", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response("upstream error", { status: 500 }),
    );
    const res = await get();
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("telegram_invalid_response");
  });
});

describe("POST /admin/set-commands", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({ ok: true, result: true }), {
            status: 200,
          }),
        ),
      );
  });
  afterEach(() => fetchSpy.mockRestore());

  const post = (headers: Record<string, string> = {}) =>
    app.request(
      "/admin/set-commands",
      {
        method: "POST",
        headers: { "x-admin-key": "test-admin-key", ...headers },
      },
      env,
    );

  it("rejects requests missing the admin key", async () => {
    const res = await post({ "x-admin-key": "" });
    expect(res.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("clears legacy slots then forwards BOT_COMMANDS to Telegram setMyCommands", async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(PUBLISH_COMMANDS_FETCH_COUNT);

    const deleteCalls = fetchSpy.mock.calls.slice(
      0,
      LEGACY_COMMAND_SLOT_PAYLOADS.length,
    );
    for (const [url] of deleteCalls) {
      expect(url).toBe(
        "https://api.telegram.org/bottest-bot-token/deleteMyCommands",
      );
    }
    expect(
      deleteCalls.map((call: unknown[]) =>
        JSON.parse((call[1] as RequestInit).body as string),
      ),
    ).toEqual(LEGACY_COMMAND_SLOT_PAYLOADS);

    const [setUrl, setInit] =
      fetchSpy.mock.calls[PUBLISH_COMMANDS_FETCH_COUNT - 1]!;
    expect(setUrl).toBe(
      "https://api.telegram.org/bottest-bot-token/setMyCommands",
    );
    const body = JSON.parse((setInit as RequestInit).body as string) as {
      commands: Array<{ command: string; description: string }>;
    };
    expect(body.commands).toEqual(
      BOT_COMMANDS.map((c) => ({
        command: c.command,
        description: c.description,
      })),
    );
  });

  it("502s when Telegram is unreachable", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("ETIMEDOUT"));
    const res = await post();
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("telegram_unreachable");
  });

  // Telegram surfaces API-level failures as HTTP 200 with { ok: false } —
  // the deploy script keys on response status, so forwarding the upstream
  // 200 unchanged would silently mark a failed publish as successful.
  it("502s when Telegram returns HTTP 200 with { ok: false }", async () => {
    const okResponse = () =>
      new Response(JSON.stringify({ ok: true, result: true }), {
        status: 200,
      });
    // Every legacy-slot delete succeeds; the final setMyCommands fails
    // at the API layer.
    for (let i = 0; i < LEGACY_COMMAND_SLOT_PAYLOADS.length; i++) {
      fetchSpy.mockResolvedValueOnce(okResponse());
    }
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: false,
          error_code: 400,
          description: "Bad Request",
        }),
        { status: 200 },
      ),
    );
    const res = await post();
    expect(res.status).toBe(502);
  });
});

describe("BOT_COMMANDS shape", () => {
  it("respects Telegram BotCommand limits", () => {
    expect(BOT_COMMANDS.length).toBeGreaterThan(0);
    for (const { command, description } of BOT_COMMANDS) {
      expect(command).toMatch(/^[a-z0-9_]{1,32}$/);
      expect(description.length).toBeGreaterThan(0);
      expect(description.length).toBeLessThanOrEqual(256);
    }
  });

  // Slash menu drift killed us before: a command wired up via
  // `bot.command()` but missing from BOT_COMMANDS is invisible to users
  // typing "/" in chat. Scan the source files instead of trusting the
  // human writer to keep two lists in sync.
  it("lists every command registered via bot.command(...)", () => {
    const registered = new Set<string>();
    for (const src of Object.values(COMMAND_SOURCES)) {
      for (const match of src.matchAll(/bot\.command\(\s*"([a-z0-9_]+)"/g)) {
        registered.add(match[1]!);
      }
    }
    expect(registered.size).toBeGreaterThan(0);
    const listed = new Set(BOT_COMMANDS.map((c) => c.command));
    const missing = [...registered].filter((c) => !listed.has(c));
    expect(missing).toEqual([]);
    const orphaned = [...listed].filter((c) => !registered.has(c));
    expect(orphaned).toEqual([]);
  });
});
