import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  answerCallbackQuery,
  editMessageText,
} from "../../lib/telegram.js";

describe("answerCallbackQuery", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("targets the answerCallbackQuery method on the right bot token", async () => {
    await answerCallbackQuery("tok-1", "cbq-1");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe(
      "https://api.telegram.org/bottok-1/answerCallbackQuery",
    );
  });

  it("includes only the callback_query_id by default (no text, no show_alert)", async () => {
    await answerCallbackQuery("tok-1", "cbq-1");
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toEqual({ callback_query_id: "cbq-1" });
  });

  it("forwards text and show_alert when provided", async () => {
    await answerCallbackQuery("tok-1", "cbq-1", {
      text: "ok",
      show_alert: true,
    });
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toEqual({
      callback_query_id: "cbq-1",
      text: "ok",
      show_alert: true,
    });
  });
});

describe("editMessageText", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("sends chat_id, message_id, and text", async () => {
    await editMessageText("tok-1", 42, 7, "hello");
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({ chat_id: 42, message_id: 7, text: "hello" });
  });

  it("locks chat_id / message_id / text against override from the extras bag", async () => {
    await editMessageText("tok-1", 42, 7, "hello", {
      chat_id: 999,
      message_id: 999,
      text: "OVERRIDE",
      reply_markup: { inline_keyboard: [] },
    });
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.chat_id).toBe(42);
    expect(body.message_id).toBe(7);
    expect(body.text).toBe("hello");
    expect(body.reply_markup).toEqual({ inline_keyboard: [] });
  });

  it("returns the raw Response so callers can branch on Telegram's 400 (message_not_found)", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ ok: false, error_code: 400, description: "message not found" }),
        { status: 400 },
      ),
    );
    const res = await editMessageText("tok-1", 42, 7, "hello");
    expect(res.status).toBe(400);
  });
});
