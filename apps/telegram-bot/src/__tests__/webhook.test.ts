import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import app from "../index.js";
import type { Env } from "../lib/types.js";

const env: Env = {
  TELEGRAM_BOT_TOKEN: "test-bot-token",
  TELEGRAM_WEBHOOK_SECRET: "test-secret",
  ADMIN_API_KEY: "test-admin-key",
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
