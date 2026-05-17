import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { makeBotHarness, withTelegramOk } from "../helpers/bot.js";
import { START_CALLBACK } from "../../keyboards/start-menu.js";
import { renderHelp } from "../../commands/help.js";
import { ANTI_PHISHING_HEADER } from "../../lib/anti-phishing.js";
import { NAV_CALLBACK } from "../../lib/nav.js";

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

const callbackUpdate = (
  data: string,
  updateId = 2,
  message: {
    text?: string;
    reply_markup?: {
      inline_keyboard: { text: string; callback_data?: string; url?: string }[][];
    };
  } = {},
) => ({
  update_id: updateId,
  callback_query: {
    id: `cbq-${updateId}`,
    from: { id: 7, is_bot: false, first_name: "Ada" },
    chat_instance: "i-1",
    message: {
      message_id: 100,
      date: 0,
      chat: { id: 42, type: "private" as const },
      ...message,
    },
    data,
  },
});

describe("renderHelp (pure)", () => {
  it("returns the overview when no topic is supplied", () => {
    const html = renderHelp(undefined, undefined);
    expect(html).toContain(ANTI_PHISHING_HEADER);
    expect(html).toContain("CortisolBot Help");
    expect(html).toContain("/wallet");
    expect(html).toContain("/buy");
    expect(html).toContain("/help wallet");
  });

  it("includes the anti-phishing reminder per AGENTS.md /help spec", () => {
    expect(renderHelp(undefined, undefined)).toContain(
      "will <b>never</b> ask for your seed phrase",
    );
  });

  it("does not direct users to alt.fun for issue support", () => {
    // The bot is operated outside alt.fun; the support-redirect line was
    // removed so the product is not falsely associated with that domain.
    const html = renderHelp(undefined, undefined);
    expect(html).not.toContain("Further questions?");
    expect(html).not.toContain("如有更多问题");
  });

  it("does not claim alt.fun distributes the bot in security tips", () => {
    // The bot is operated outside alt.fun, so the anti-phishing copy must
    // not direct users to source the bot link from alt.fun. The neutral
    // "follow links from sources you already trust" wording replaces it.
    const overview = renderHelp(undefined, undefined);
    const security = renderHelp("security", undefined);
    for (const html of [overview, security]) {
      expect(html).not.toMatch(/link from .*alt\.fun/i);
      expect(html).not.toMatch(/Only use the .* link from/i);
    }
    expect(security).toContain("sources you already trust");
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
    expect(send!.body.text).toContain("CortisolBot Help");
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
    expect(send!.body.text).toContain("Alt Fun fee 0.75%");
    // Overview-specific heading must not leak into the topic view.
    expect(send!.body.text).not.toContain("CortisolBot Help");
  });

  it("replaces the /start menu message in place with the help overview and a Back/Home nav row", async () => {
    const h = makeBotHarness();
    await h.run(callbackUpdate(START_CALLBACK.help));

    const calls = capture(fetchSpy);
    const answer = calls.find((c) => c.url.includes("/answerCallbackQuery"));
    const edit = calls.find((c) => c.url.includes("/editMessageText"));
    const send = calls.find((c) => c.url.includes("/sendMessage"));

    // Silent ack — the help body is now delivered via editMessageText
    // (in-place replace) rather than a brand-new ctx.reply.
    expect(answer).toBeDefined();
    expect(answer!.body.show_alert).toBeFalsy();
    expect(edit).toBeDefined();
    expect(send).toBeUndefined();
    expect(edit!.body.text).toContain("CortisolBot Help");
    expect(edit!.body.parse_mode).toBe("HTML");
    expect(edit!.body.link_preview_options).toEqual({ is_disabled: true });

    // Final inline_keyboard row must be [← Back] [🏠 Home] so the user
    // can navigate back to /start without re-typing the command.
    const keyboard = (
      edit!.body.reply_markup as {
        inline_keyboard: { text: string; callback_data: string }[][];
      }
    ).inline_keyboard;
    const lastRow = keyboard[keyboard.length - 1]!;
    expect(lastRow.map((b) => b.callback_data)).toEqual([
      NAV_CALLBACK.back,
      NAV_CALLBACK.home,
    ]);
    expect(lastRow.map((b) => b.text)).toEqual(["← Back", "🏠 Home"]);
  });

  it("pushes the /start snapshot onto the nav stack so Back can restore it", async () => {
    const h = makeBotHarness();
    const startMessage = {
      text: "Welcome to CortisolBot — your wallet address: 0xabc",
      reply_markup: {
        inline_keyboard: [
          [{ text: "Buy", callback_data: "st:b" }],
        ],
      },
    };

    await h.run(callbackUpdate(START_CALLBACK.help, 2, startMessage));

    // Session is keyed by userId (7) and persisted to KV via the
    // grammY session middleware. Read it back to confirm the snapshot
    // landed on `navStack` — that's the only contract the Back handler
    // (already tested in nav.test.ts) consumes.
    const raw = (await h.kv.get("session:7")) as string | null;
    expect(raw).toBeTruthy();
    const session = JSON.parse(raw!) as {
      navStack?: { text: string; keyboard: unknown[][] }[];
    };
    expect(session.navStack).toBeDefined();
    expect(session.navStack!.length).toBe(1);
    expect(session.navStack![0]!.text).toBe(startMessage.text);
  });

  it("falls back to delete+reply when the original /start message can no longer be edited", async () => {
    const h = makeBotHarness();
    // Telegram returns a benign 400 for editMessageText (message gone).
    // Our handler should swallow the edit failure, best-effort delete
    // the stale message, and recreate the help screen via sendMessage.
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/editMessageText")) {
        return new Response(
          JSON.stringify({
            ok: false,
            error_code: 400,
            description: "Bad Request: message to edit not found",
          }),
          { status: 400 },
        );
      }
      return new Response(JSON.stringify({ ok: true, result: true }), {
        status: 200,
      });
    });

    await h.run(callbackUpdate(START_CALLBACK.help));

    const calls = capture(fetchSpy);
    const edit = calls.find((c) => c.url.includes("/editMessageText"));
    const del = calls.find((c) => c.url.includes("/deleteMessage"));
    const send = calls.find((c) => c.url.includes("/sendMessage"));
    expect(edit).toBeDefined();
    expect(del).toBeDefined();
    expect(send).toBeDefined();
    expect(send!.body.text).toContain("CortisolBot Help");
    const keyboard = (
      send!.body.reply_markup as {
        inline_keyboard: { text: string; callback_data: string }[][];
      }
    ).inline_keyboard;
    expect(keyboard[keyboard.length - 1]!.map((b) => b.callback_data)).toEqual([
      NAV_CALLBACK.back,
      NAV_CALLBACK.home,
    ]);
  });
});
