import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { makeBotHarness } from "../helpers/bot.js";

const WALLET = "0x1234567890abcdef1234567890abcdef12345678";

const mockApi = (
  fetchSpy: ReturnType<typeof vi.spyOn>,
  open: number,
): void => {
  const items = Array.from({ length: open }, (_, i) => ({
    token: `0x${i.toString(16).padStart(40, "0")}`,
    ticker: `LT${i}`,
    balance: "1000000000000000000",
    costBasisUsdc: "1000000",
    currentValueUsdc: "1500000",
    unrealisedPnlUsdc: "500000",
    unrealisedPnlPct: 50,
  }));
  fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/v1/bot/positions/")) {
      return new Response(
        JSON.stringify({ data: { open: items, realised: [] } }),
        { status: 200 },
      );
    }
    return new Response(
      JSON.stringify({ ok: true, result: true }),
      { status: 200 },
    );
  });
};

const ppCallback = (data: string) => ({
  update_id: 10,
  callback_query: {
    id: "cbq-1",
    from: { id: 7, is_bot: false, first_name: "Ada" },
    chat_instance: "instance-1",
    data,
    message: {
      message_id: 99,
      date: 0,
      chat: { id: 42, type: "private" as const },
    },
  },
});

interface TgCall {
  url: string;
  body: Record<string, unknown>;
}

const collectCalls = (fetchSpy: ReturnType<typeof vi.spyOn>): TgCall[] =>
  (fetchSpy.mock.calls as Array<[unknown, unknown?]>)
    .filter((call) => {
      // GET requests to api.test.local have no body — skip them.
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

describe("pp callback (positions pagination)", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("toasts 'invalid page request' when the page index is not numeric", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: true }), { status: 200 }),
    );
    const h = makeBotHarness();
    await h.run(ppCallback(`pp:not-a-number:${WALLET}`));
    const answer = collectCalls(fetchSpy).find((c) =>
      c.url.includes("/answerCallbackQuery"),
    );
    expect(answer?.body.text).toBe("Invalid page request.");
  });

  it("toasts 'invalid page request' when the wallet arg is not an address", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: true }), { status: 200 }),
    );
    const h = makeBotHarness();
    await h.run(ppCallback("pp:1:not-a-wallet"));
    const answer = collectCalls(fetchSpy).find((c) =>
      c.url.includes("/answerCallbackQuery"),
    );
    expect(answer?.body.text).toBe("Invalid page request.");
  });

  it("toasts a degraded-data message when the upstream API is 503", async () => {
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).startsWith("https://api.test.local")) {
        return new Response("{}", { status: 503 });
      }
      return new Response(
        JSON.stringify({ ok: true, result: true }),
        { status: 200 },
      );
    });
    const h = makeBotHarness();
    await h.run(ppCallback(`pp:1:${WALLET}`));
    const answer = collectCalls(fetchSpy).find((c) =>
      c.url.includes("/answerCallbackQuery"),
    );
    expect(answer?.body.text).toContain("Data temporarily unavailable");
  });

  it("edits the originating message with the requested page content + per-position rows scoped to that page + nav row", async () => {
    mockApi(fetchSpy, 250);
    const h = makeBotHarness();
    await h.run(ppCallback(`pp:1:${WALLET}`));
    const editCalls = collectCalls(fetchSpy).filter((c) =>
      c.url.includes("/editMessageText"),
    );
    expect(editCalls).toHaveLength(1);
    const body = editCalls[0]!.body as {
      chat_id: number;
      message_id: number;
      text: string;
      parse_mode?: string;
      reply_markup: {
        inline_keyboard: { text: string; callback_data: string }[][];
      };
    };
    expect(body.chat_id).toBe(42);
    expect(body.message_id).toBe(99);
    expect(body.text).toContain("Page 2 of");
    // Body no longer carries `t.me?start=...` anchors — per-position
    // callback buttons replace them so the action fires inline.
    expect(body.parse_mode).toBe("HTML");
    expect(body.text).not.toContain("?start=buy_");
    expect(body.text).not.toContain("?start=sell_");
    const rows = body.reply_markup.inline_keyboard;
    expect(rows.length).toBeGreaterThan(2);
    // Last row is Close, second-to-last is the nav row.
    expect(rows[rows.length - 1]!.map((b) => b.text)).toEqual(["← Back", "🏠 Home"]);
    const nav = rows[rows.length - 2]!;
    const navTexts = nav.map((b) => b.text);
    expect(navTexts).toContain("← Prev");
    if (navTexts.length > 1) expect(navTexts).toContain("Next →");
    for (const b of nav) {
      expect(b.callback_data).toMatch(/^pp:\d+:0x[0-9a-f]{40}$/i);
    }
    // Every non-nav, non-Close row must be a Buy/Sell pair pointing at
    // a token. The tickers on this page must also appear in the body
    // text — so a navigation never desyncs the keyboard from the
    // visible list.
    for (let i = 0; i < rows.length - 2; i++) {
      const row = rows[i]!;
      expect(row).toHaveLength(2);
      const buyLabel = row[0]!.text;
      const sellLabel = row[1]!.text;
      expect(buyLabel.startsWith("Buy ")).toBe(true);
      expect(sellLabel.startsWith("Sell ")).toBe(true);
      expect(row[0]!.callback_data.startsWith("pb:0x")).toBe(true);
      expect(row[1]!.callback_data.startsWith("ps:0x")).toBe(true);
      const ticker = buyLabel.slice("Buy ".length);
      expect(body.text).toContain(ticker);
    }
  });

  it("clamps to the last available page when positions have shrunk since the button was rendered", async () => {
    mockApi(fetchSpy, 1);
    const h = makeBotHarness();
    await h.run(ppCallback(`pp:99:${WALLET}`));
    const editCalls = collectCalls(fetchSpy).filter((c) =>
      c.url.includes("/editMessageText"),
    );
    expect(editCalls).toHaveLength(1);
    const body = editCalls[0]!.body as {
      text: string;
      reply_markup?: {
        inline_keyboard: { text: string; callback_data: string }[][];
      };
    };
    // Single page → no "Page X of Y" footer. Still has one per-position
    // row of [Buy] / [Sell] buttons.
    expect(body.text).not.toContain("Page ");
    expect(body.text).not.toContain("?start=buy_");
    expect(body.text).not.toContain("?start=sell_");
    const rows = body.reply_markup!.inline_keyboard;
    // One action row + trailing Close row.
    expect(rows).toHaveLength(2);
    expect(rows[0]![0]!.callback_data.startsWith("pb:0x")).toBe(true);
    expect(rows[0]![1]!.callback_data.startsWith("ps:0x")).toBe(true);
    expect(rows[1]!.map((b) => b.text)).toEqual(["← Back", "🏠 Home"]);
  });

  it("ACKs the callback (answerCallbackQuery) even when editMessageText fails (deleted msg / not modified)", async () => {
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/v1/bot/positions/")) {
        return new Response(
          JSON.stringify({
            data: {
              open: Array.from({ length: 250 }, (_, i) => ({
                token: `0x${i.toString(16).padStart(40, "0")}`,
                ticker: `LT${i}`,
                balance: "1000000000000000000",
                costBasisUsdc: "1000000",
                currentValueUsdc: "1500000",
                unrealisedPnlUsdc: "500000",
                unrealisedPnlPct: 50,
              })),
              realised: [],
            },
          }),
          { status: 200 },
        );
      }
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
      return new Response(
        JSON.stringify({ ok: true, result: true }),
        { status: 200 },
      );
    });
    const h = makeBotHarness();
    await h.run(ppCallback(`pp:1:${WALLET}`));
    const answer = collectCalls(fetchSpy).find((c) =>
      c.url.includes("/answerCallbackQuery"),
    );
    expect(answer).toBeDefined();
  });
});
