import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { makeBotHarness, mockTelegramOk } from "../helpers/bot.js";
import { START_CALLBACK } from "../../keyboards/start-menu.js";

const securityCommand = (fromId: number) => ({
  update_id: 1,
  message: {
    message_id: 1,
    date: 0,
    chat: { id: 42, type: "private" as const },
    from: { id: fromId, is_bot: false, first_name: "Ada" },
    text: "/security",
    entities: [{ type: "bot_command", offset: 0, length: 9 }],
  },
});

const callbackUpdate = (data: string) => ({
  update_id: 2,
  callback_query: {
    id: "cbq-1",
    from: { id: 7, is_bot: false, first_name: "Ada" },
    chat_instance: "i-1",
    message: {
      message_id: 100,
      date: 0,
      chat: { id: 42, type: "private" as const },
    },
    data,
  },
});

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

describe("/security command (redirect)", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
    mockTelegramOk(fetchSpy);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("renders a redirect pointing to /wallet (PIN + lock) and /settings (phrase)", async () => {
    const h = makeBotHarness();
    await h.run(securityCommand(7));
    const send = capture(fetchSpy).find((c) =>
      c.url.includes("/sendMessage"),
    );
    expect(send).toBeDefined();
    const text = send!.body.text as string;
    expect(text).toContain("/wallet");
    expect(text).toContain("/settings");
    expect(text).toContain("anti-phishing phrase");
    // The keyboard is the navigation row only — no PIN, lock, or phrase buttons.
    const keyboard = (
      send!.body.reply_markup as {
        inline_keyboard: { text: string }[][];
      }
    ).inline_keyboard;
    const buttonTexts = keyboard.flat().map((b) => b.text);
    expect(buttonTexts).toEqual(["← Back", "🏠 Home"]);
  });

  it("the start-menu Security button sends the redirect as a fresh message", async () => {
    const h = makeBotHarness();
    await h.run(callbackUpdate(START_CALLBACK.security));
    const calls = capture(fetchSpy);
    const send = calls.find((c) => c.url.includes("/sendMessage"));
    const answer = calls.find((c) => c.url.includes("/answerCallbackQuery"));
    const edit = calls.find((c) => c.url.includes("/editMessageText"));
    expect(send).toBeDefined();
    expect(send!.body.text).toContain("/wallet");
    expect(answer).toBeDefined();
    expect(answer!.body.show_alert).toBeFalsy();
    // The "fresh message" promise — no editMessageText must fire.
    expect(edit).toBeUndefined();
  });

  it("rejects /security in a group chat without leaking redirect details", async () => {
    const h = makeBotHarness();
    const groupUpdate = {
      ...securityCommand(7),
      message: {
        ...securityCommand(7).message,
        chat: { id: 42, type: "group" as const, title: "shared" },
      },
    };
    await h.run(groupUpdate);
    const send = capture(fetchSpy).find((c) =>
      c.url.includes("/sendMessage"),
    );
    expect(send).toBeDefined();
    const text = send!.body.text as string;
    expect(text).toContain("private-DM only");
    // Group-chat rejection must not surface the redirect targets
    // either — they would leak the user's command intent into the
    // group transcript.
    expect(text).not.toContain("/wallet");
    expect(text).not.toContain("/settings");
  });
});
