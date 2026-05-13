import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeBotHarness, mockTelegramOk } from "../helpers/bot.js";
import { CLOSE_CALLBACK, closeButtonRow } from "../../lib/close.js";

interface TgCall {
  url: string;
  body: Record<string, unknown>;
}

const capture = (fetchSpy: ReturnType<typeof vi.spyOn>): TgCall[] =>
  (fetchSpy.mock.calls as Array<[unknown, unknown?]>).map((call) => ({
    url: String(call[0]),
    body: JSON.parse((call[1] as RequestInit).body as string) as Record<
      string,
      unknown
    >,
  }));

const closeCallbackUpdate = () => ({
  update_id: 42,
  callback_query: {
    id: "cbq-close",
    from: { id: 7, is_bot: false, first_name: "Ada" },
    chat_instance: "i-1",
    message: {
      message_id: 999,
      date: 0,
      chat: { id: 42, type: "private" as const },
    },
    data: CLOSE_CALLBACK,
  },
});

describe("closeButtonRow", () => {
  it("returns a single Close button with the shared callback code", () => {
    expect(closeButtonRow()).toEqual([
      { text: "Close", callback_data: CLOSE_CALLBACK },
    ]);
  });

  it("uses a callback_data that stays well inside Telegram's 64-byte budget", () => {
    const [btn] = closeButtonRow();
    // Telegram measures `callback_data` in UTF-8 bytes, not UTF-16 code
    // units — encode before comparing so a future multibyte change to
    // CLOSE_CALLBACK doesn't silently pass while overflowing the wire.
    const bytes = new TextEncoder().encode(btn!.callback_data).length;
    expect(bytes).toBeLessThanOrEqual(64);
  });
});

describe("Close callback handler", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
    mockTelegramOk(fetchSpy);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("deletes the message the user tapped Close on and ACKs the callback", async () => {
    const h = makeBotHarness();
    await h.run(closeCallbackUpdate());

    const calls = capture(fetchSpy);
    const del = calls.find((c) => c.url.includes("/deleteMessage"));
    const ack = calls.find((c) => c.url.includes("/answerCallbackQuery"));

    expect(del).toBeDefined();
    expect(del!.body.chat_id).toBe(42);
    expect(del!.body.message_id).toBe(999);
    expect(ack).toBeDefined();
  });

  it("falls back to clearing the keyboard when deleteMessage returns a benign 400", async () => {
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/deleteMessage")) {
        return new Response(
          JSON.stringify({
            ok: false,
            error_code: 400,
            description: "Bad Request: message to delete not found",
          }),
          { status: 400 },
        );
      }
      return new Response(JSON.stringify({ ok: true, result: true }), {
        status: 200,
      });
    });

    const h = makeBotHarness();
    await h.run(closeCallbackUpdate());

    const calls = capture(fetchSpy);
    const editMarkup = calls.find((c) =>
      c.url.includes("/editMessageReplyMarkup"),
    );
    const ack = calls.find((c) => c.url.includes("/answerCallbackQuery"));

    expect(editMarkup).toBeDefined();
    expect(ack).toBeDefined();
  });

  it("does not fall back to editing the keyboard for non-benign deleteMessage errors", async () => {
    // Simulate a real failure mode — e.g. an authorisation error.
    // The handler must ACK the callback (so Telegram stops re-spinning
    // the user's tap) and surface the error via bot.catch rather than
    // hiding it behind a successful-looking edit-markup call.
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/deleteMessage")) {
        return new Response(
          JSON.stringify({
            ok: false,
            error_code: 403,
            description: "Forbidden: bot was blocked by the user",
          }),
          { status: 403 },
        );
      }
      return new Response(JSON.stringify({ ok: true, result: true }), {
        status: 200,
      });
    });

    const h = makeBotHarness();
    // Rethrow inside the handler surfaces through grammY as a BotError;
    // catch it so we can still assert what calls happened.
    await expect(h.run(closeCallbackUpdate())).rejects.toThrow();

    const calls = capture(fetchSpy);
    const editMarkup = calls.find((c) =>
      c.url.includes("/editMessageReplyMarkup"),
    );
    const ack = calls.find((c) => c.url.includes("/answerCallbackQuery"));

    // ACK fires so Telegram unsticks the spinner, but we do NOT silently
    // try to mutate the message after a non-benign deleteMessage error.
    expect(ack).toBeDefined();
    expect(editMarkup).toBeUndefined();
  });
});
