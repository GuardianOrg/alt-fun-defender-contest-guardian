import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import app from "../index.js";
import { BOT_COMMANDS } from "../lib/bot-commands.js";
import { makeTestEnv } from "./helpers/env.js";

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

describe("POST /admin/set-webhook", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true, result: true }), {
          status: 200,
        }),
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
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://api.telegram.org/bottest-bot-token/setWebhook");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.url).toBe("https://example.com/webhook");
    expect(body.secret_token).toBe("test-secret");
    expect(body.allowed_updates).toEqual(["message", "callback_query"]);
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
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true, result: true }), {
          status: 200,
        }),
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

  it("forwards BOT_COMMANDS to Telegram setMyCommands", async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe(
      "https://api.telegram.org/bottest-bot-token/setMyCommands",
    );
    const body = JSON.parse((init as RequestInit).body as string) as {
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
});
