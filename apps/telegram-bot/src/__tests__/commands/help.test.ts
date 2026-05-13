import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { makeBotHarness, withTelegramOk } from "../helpers/bot.js";
import { START_CALLBACK } from "../../keyboards/start-menu.js";
import { renderHelp } from "../../commands/help.js";
import { ANTI_PHISHING_HEADER } from "../../lib/anti-phishing.js";

interface TgCall {
  url: string;
  body: Record<string, unknown>;
}

const capture = (fetchSpy: ReturnType<typeof vi.spyOn>): TgCall[] =>
  (fetchSpy.mock.calls as Array<[unknown, unknown?]>)
    .filter((call) => {
      const init = call[1] as RequestInit | undefined;
      return typeof init?.body === "string";
    })
    .map((call) => ({
      url: String(call[0]),
      body: JSON.parse((call[1] as RequestInit).body as string) as Record<
        string,
        unknown
      >,
    }));

const helpUpdate = (text: string, updateId = 1) => {
  // First whitespace-delimited token is the command (including any @bot
  // suffix); the rest is what grammY parses into `ctx.match`.
  const cmd = text.split(/\s+/)[0] ?? "/help";
  return {
    update_id: updateId,
    message: {
      message_id: 1,
      date: 0,
      chat: { id: 42, type: "private" as const },
      from: { id: 7, is_bot: false, first_name: "Ada" },
      text,
      entities: [{ type: "bot_command", offset: 0, length: cmd.length }],
    },
  };
};

const callbackUpdate = (data: string, updateId = 2) => ({
  update_id: updateId,
  callback_query: {
    id: `cbq-${updateId}`,
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

describe("renderHelp (pure)", () => {
  it("returns the overview when no topic is supplied", () => {
    const html = renderHelp(undefined, undefined);
    expect(html).toContain(ANTI_PHISHING_HEADER);
    expect(html).toContain("AltFunBot Help");
    expect(html).toContain("/wallet");
    expect(html).toContain("/buy");
    expect(html).toContain("/help wallet");
  });

  it("includes the anti-phishing reminder per AGENTS.md /help spec", () => {
    expect(renderHelp(undefined, undefined)).toContain(
      "will <b>never</b> ask for your seed phrase",
    );
  });

  it.each([
    ["wallet", "AES-256-GCM"],
    ["wallets", "AES-256-GCM"],
    ["trade", "Buying and selling"],
    ["buy", "Buying and selling"],
    ["sell", "Buying and selling"],
    ["fees", "Bot fee 0.5%"],
    ["pnl", "Net Profit"],
    ["security", "anti-phishing phrase"],
    ["sap", "anti-phishing phrase"],
    ["referral", "Rewards wallet"],
    ["referrals", "Rewards wallet"],
    ["withdraw", "60-second timeout"],
    ["withdrawal", "60-second timeout"],
  ])("topic %s renders a dedicated body containing %s", (topic, needle) => {
    const html = renderHelp(topic, undefined);
    expect(html).toContain(needle);
    expect(html).toContain(ANTI_PHISHING_HEADER);
  });

  it("is case-insensitive and ignores surrounding whitespace", () => {
    expect(renderHelp("  WALLET  ", undefined)).toBe(
      renderHelp("wallet", undefined),
    );
  });

  it("uses the user's anti-phishing phrase in place of the static header", () => {
    const html = renderHelp(undefined, "purple-otter-42");
    expect(html).toContain("purple-otter-42");
    expect(html).not.toContain(ANTI_PHISHING_HEADER);
  });

  it("HTML-escapes the user phrase so /help can't render an attacker-controlled tag", () => {
    const html = renderHelp(undefined, '<a&b"c>');
    // Raw chars must be replaced; escaped sequences must appear.
    expect(html).not.toMatch(/<a&b"c>/);
    expect(html).toContain("&lt;a&amp;b&quot;c&gt;");
    expect(html).not.toContain(ANTI_PHISHING_HEADER);
  });

  it("falls back to the static header when no phrase is set", () => {
    expect(renderHelp(undefined, null)).toContain(ANTI_PHISHING_HEADER);
    expect(renderHelp("fees", undefined)).toContain(ANTI_PHISHING_HEADER);
  });

  it("returns an unknown-topic hint when the arg is not a known topic", () => {
    const html = renderHelp("nonsense", undefined);
    expect(html).toContain("Unknown help topic");
    expect(html).toContain("<code>wallet</code>");
  });
});

describe("/help command", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
    withTelegramOk(fetchSpy, async (input) => {
      throw new Error(`Unexpected fetch in test: ${String(input)}`);
    });
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("replies with the overview when called with no argument", async () => {
    const h = makeBotHarness();
    await h.run(helpUpdate("/help"));

    const send = capture(fetchSpy).find((c) => c.url.includes("/sendMessage"));
    expect(send).toBeDefined();
    expect(send!.body.parse_mode).toBe("HTML");
    expect(send!.body.text).toContain("AltFunBot Help");
    expect(send!.body.text).toContain(ANTI_PHISHING_HEADER);
    // Help responses must not generate a link-preview card — the bot
    // links out to alt.fun and a preview would push the topic list
    // off-screen on mobile.
    expect(send!.body.link_preview_options).toEqual({ is_disabled: true });
  });

  it("renders the requested topic when called as /help <topic>", async () => {
    const h = makeBotHarness();
    await h.run(helpUpdate("/help fees"));

    const send = capture(fetchSpy).find((c) => c.url.includes("/sendMessage"));
    expect(send!.body.text).toContain("Bot fee 0.5%");
    expect(send!.body.text).toContain("Alt Fun fee 0.5%");
    // Overview-specific heading must not leak into the topic view.
    expect(send!.body.text).not.toContain("AltFunBot Help");
  });

  it("handles the start-menu Help button (st:h) with the overview", async () => {
    const h = makeBotHarness();
    await h.run(callbackUpdate(START_CALLBACK.help));

    const calls = capture(fetchSpy);
    const answer = calls.find((c) => c.url.includes("/answerCallbackQuery"));
    const send = calls.find((c) => c.url.includes("/sendMessage"));
    // Silent ack — the help body is delivered as a new message rather
    // than a 200-char alert toast.
    expect(answer).toBeDefined();
    expect(answer!.body.show_alert).toBeFalsy();
    expect(send).toBeDefined();
    expect(send!.body.text).toContain("AltFunBot Help");
  });
});
