import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import app from "../index.js";
import type { Env } from "../lib/types.js";

const env: Env = {
  TELEGRAM_BOT_TOKEN: "test-bot-token",
  TELEGRAM_WEBHOOK_SECRET: "test-secret",
  ADMIN_API_KEY: "test-admin-key",
  API_BASE_URL: "https://api.test.local",
  API_KEY: "test-api-key",
};

const update = (text: string) => ({
  update_id: 1,
  message: {
    message_id: 1,
    date: 0,
    chat: { id: 42, type: "private" },
    from: { id: 7, is_bot: false, first_name: "Ada" },
    text,
    entities: [{ type: "bot_command", offset: 0, length: text.length }],
  },
});

describe("POST /webhook", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("rejects requests without the secret header", async () => {
    const res = await app.request(
      "/webhook",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(update("/start")),
      },
      env,
    );
    expect(res.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects requests with a wrong secret", async () => {
    const res = await app.request(
      "/webhook",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token": "nope",
        },
        body: JSON.stringify(update("/start")),
      },
      env,
    );
    expect(res.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("replies via sendMessage when /start arrives", async () => {
    const res = await app.request(
      "/webhook",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token": "test-secret",
        },
        body: JSON.stringify(update("/start")),
      },
      env,
    );
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://api.telegram.org/bottest-bot-token/sendMessage");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.chat_id).toBe(42);
    expect(body.text).toContain("Ada");
  });

  it("ACKs malformed JSON instead of 5xx (avoids Telegram retry storm)", async () => {
    const res = await app.request(
      "/webhook",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token": "test-secret",
        },
        body: "not json",
      },
      env,
    );
    expect(res.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("ACKs even when sendMessage throws", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("telegram down"));
    const res = await app.request(
      "/webhook",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token": "test-secret",
        },
        body: JSON.stringify(update("/start")),
      },
      env,
    );
    expect(res.status).toBe(200);
    // Prove sendMessage was actually attempted — otherwise this test passes
    // even if /start silently stops dispatching.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("sends as plain text (no parse_mode) so HTML chars in names don't 400", async () => {
    const htmlNameUpdate = {
      update_id: 4,
      message: {
        message_id: 4,
        date: 0,
        chat: { id: 42, type: "private" },
        from: { id: 7, is_bot: false, first_name: "Tom & <Jerry>" },
        text: "/start",
        entities: [{ type: "bot_command", offset: 0, length: 6 }],
      },
    };
    const res = await app.request(
      "/webhook",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token": "test-secret",
        },
        body: JSON.stringify(htmlNameUpdate),
      },
      env,
    );
    expect(res.status).toBe(200);
    const body = JSON.parse(
      (fetchSpy.mock.calls[0]![1] as RequestInit).body as string,
    );
    expect(body.parse_mode).toBeUndefined();
    expect(body.text).toContain("Tom & <Jerry>");
  });

  it("ACKs and no-ops when update.message is absent", async () => {
    const res = await app.request(
      "/webhook",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token": "test-secret",
        },
        body: JSON.stringify({ update_id: 99 }),
      },
      env,
    );
    expect(res.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("falls back to 'there' greeting when from.first_name is absent", async () => {
    const noFromUpdate = {
      update_id: 3,
      message: {
        message_id: 3,
        date: 0,
        chat: { id: 42, type: "private" },
        // no `from` — happens for channel posts, anonymous group admins
        text: "/start",
        entities: [{ type: "bot_command", offset: 0, length: 6 }],
      },
    };
    const res = await app.request(
      "/webhook",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token": "test-secret",
        },
        body: JSON.stringify(noFromUpdate),
      },
      env,
    );
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse(
      (fetchSpy.mock.calls[0]![1] as RequestInit).body as string,
    );
    expect(body.text).toContain("Hi there!");
  });

  it("ignores non-command messages", async () => {
    const res = await app.request(
      "/webhook",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token": "test-secret",
        },
        body: JSON.stringify({
          update_id: 2,
          message: {
            message_id: 2,
            date: 0,
            chat: { id: 42, type: "private" },
            text: "hello",
          },
        }),
      },
      env,
    );
    expect(res.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
