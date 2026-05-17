import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { makeBotHarness } from "../helpers/bot.js";

const WALLET = "0x1234567890abcdef1234567890abcdef12345678";

const mockApi = (
  fetchSpy: ReturnType<typeof vi.spyOn>,
  open: number,
  realised: number = 0,
): void => {
  const openItems = Array.from({ length: open }, (_, i) => ({
    token: `0x${i.toString(16).padStart(40, "0")}`,
    ticker: `LT${i}`,
    balance: "1000000000000000000",
    costBasisUsdc: "1000000",
    currentValueUsdc: "1500000",
    unrealisedPnlUsdc: "500000",
    unrealisedPnlPct: 50,
  }));
  const realisedItems = Array.from({ length: realised }, (_, i) => ({
    token: `0x${(1000 + i).toString(16).padStart(40, "0")}`,
    ticker: `R${i}`,
    totalCostUsdc: "1000000",
    totalProceedsUsdc: "1500000",
    realisedPnlUsdc: "500000",
    realisedPnlPct: 50,
  }));
  fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/v1/bot/positions-v2/")) {
      return new Response(
        JSON.stringify({
          data: { open: openItems, realised: realisedItems },
        }),
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

  it("toasts 'invalid page request' when the open-page index is not numeric", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: true }), { status: 200 }),
    );
    const h = makeBotHarness();
    await h.run(ppCallback(`pp:not-a-number:0:${WALLET}`));
    const answer = collectCalls(fetchSpy).find((c) =>
      c.url.includes("/answerCallbackQuery"),
    );
    expect(answer?.body.text).toBe("Invalid page request.");
  });

  it("toasts 'invalid page request' when the realised-page index is not numeric", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: true }), { status: 200 }),
    );
    const h = makeBotHarness();
    await h.run(ppCallback(`pp:0:not-a-number:${WALLET}`));
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
    await h.run(ppCallback("pp:1:0:not-a-wallet"));
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
    await h.run(ppCallback(`pp:1:0:${WALLET}`));
    const answer = collectCalls(fetchSpy).find((c) =>
      c.url.includes("/answerCallbackQuery"),
    );
    expect(answer?.body.text).toContain("Data temporarily unavailable");
  });

  it("edits the originating message with the requested open page + per-position rows scoped to that page + open nav row", async () => {
    // 47 open positions → page size 5 → 10 pages. Clicking
    // `pp:1:0:<wallet>` jumps to open-page index 1 (= page 2 of 10),
    // showing LT5..LT9.
    mockApi(fetchSpy, 47);
    const h = makeBotHarness();
    await h.run(ppCallback(`pp:1:0:${WALLET}`));
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
    expect(body.parse_mode).toBe("HTML");
    // Body ticker is a `t.me/<bot>?start=track_<addr>` deeplink. The
    // legacy buy/sell body anchors stay gone — those are inline
    // callback buttons now.
    expect(body.text).not.toContain("?start=buy_");
    expect(body.text).not.toContain("?start=sell_");
    expect(body.text).toContain("?start=track_");
    // Page 2 of 10 → LT5..LT9 visible, LT4 / LT10 are not.
    for (let i = 5; i <= 9; i++) {
      expect(body.text).toContain(`LT${i}`);
    }
    expect(body.text).not.toContain("LT4");
    expect(body.text).not.toContain("LT10");

    const rows = body.reply_markup.inline_keyboard;
    // Open nav row + refresh + back/home. No per-position rows.
    expect(rows).toHaveLength(3);
    expect(rows[rows.length - 1]!.map((b) => b.text)).toEqual([
      "← Back",
      "🏠 Home",
    ]);
    const refreshRow = rows[rows.length - 2]!;
    expect(refreshRow.map((b) => b.text)).toEqual(["🔄 Refresh"]);
    expect(refreshRow[0]!.callback_data).toMatch(
      /^pr:1:0:0x[0-9a-f]{40}$/i,
    );
    const openNav = rows[0]!;
    expect(openNav.map((b) => b.text)).toEqual([
      "← Page 1/10 Open Pos",
      "→ Page 3/10 Open Pos",
    ]);
    for (const b of openNav) {
      expect(b.callback_data).toMatch(/^pp:\d+:0:0x[0-9a-f]{40}$/i);
    }
    // No per-position buy/sell callbacks anywhere in the keyboard.
    for (const b of rows.flat()) {
      expect(b.callback_data.startsWith("pb:")).toBe(false);
      expect(b.callback_data.startsWith("ps:")).toBe(false);
    }
  });

  it("preserves the open-page index when navigating realised: `pp:2:1:<wallet>` slices realised page 2 and keeps open on page 3", async () => {
    // Open: 47 records → 10 pages. Realised: 12 records → 3 pages.
    mockApi(fetchSpy, 47, 12);
    const h = makeBotHarness();
    await h.run(ppCallback(`pp:2:1:${WALLET}`));
    const editCalls = collectCalls(fetchSpy).filter((c) =>
      c.url.includes("/editMessageText"),
    );
    expect(editCalls).toHaveLength(1);
    const body = editCalls[0]!.body as {
      text: string;
      reply_markup: {
        inline_keyboard: { text: string; callback_data: string }[][];
      };
    };
    // Open page index 2 → LT10..LT14.
    for (let i = 10; i <= 14; i++) {
      expect(body.text).toContain(`LT${i}`);
    }
    expect(body.text).not.toContain("LT15");
    // Realised page index 1 → R5..R9.
    for (let i = 5; i <= 9; i++) {
      expect(body.text).toContain(`R${i}`);
    }
    expect(body.text).not.toContain("R10");

    const rows = body.reply_markup.inline_keyboard;
    // open nav + realised nav + refresh + back/home (no per-position rows).
    expect(rows).toHaveLength(4);
    const openNav = rows[0]!;
    expect(openNav.map((b) => b.text)).toEqual([
      "← Page 2/10 Open Pos",
      "→ Page 4/10 Open Pos",
    ]);
    // Realised page on every open-nav callback stays at 1 (the current
    // realised page index) so navigation never disturbs the other axis.
    expect(openNav[0]!.callback_data).toBe(`pp:1:1:${WALLET}`);
    expect(openNav[1]!.callback_data).toBe(`pp:3:1:${WALLET}`);
    const realisedNav = rows[1]!;
    expect(realisedNav.map((b) => b.text)).toEqual([
      "← Page 1/3 Realized Pos",
      "→ Page 3/3 Realized Pos",
    ]);
    expect(realisedNav[0]!.callback_data).toBe(`pp:2:0:${WALLET}`);
    expect(realisedNav[1]!.callback_data).toBe(`pp:2:2:${WALLET}`);
  });

  it("clamps to the last available page when positions have shrunk since the button was rendered", async () => {
    mockApi(fetchSpy, 1);
    const h = makeBotHarness();
    await h.run(ppCallback(`pp:99:0:${WALLET}`));
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
    // Body ticker is deeplinked back to `/start track_<addr>`; buy/sell
    // stay as inline callback buttons (no body anchors).
    expect(body.text).not.toContain("?start=buy_");
    expect(body.text).not.toContain("?start=sell_");
    expect(body.text).toContain("?start=track_");
    const rows = body.reply_markup!.inline_keyboard;
    // Open Pos label row + refresh row + trailing Back/Home row.
    expect(rows).toHaveLength(3);
    expect(rows[0]!.map((b) => b.text)).toEqual(["Page 1/1 Open Pos"]);
    expect(rows[0]![0]!.callback_data).toMatch(/^pp:0:0:0x[0-9a-f]{40}$/i);
    expect(rows[1]!.map((b) => b.text)).toEqual(["🔄 Refresh"]);
    expect(rows[1]![0]!.callback_data).toMatch(/^pr:0:0:0x[0-9a-f]{40}$/i);
    expect(rows[2]!.map((b) => b.text)).toEqual(["← Back", "🏠 Home"]);
  });

  it("pr callback refreshes positions in place and toasts 'Refreshed' (proceeds + realised reflect latest indexer state)", async () => {
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/v1/bot/positions-v2/")) {
        return new Response(
          JSON.stringify({
            data: {
              open: [
                {
                  token: "0xaaaa000000000000000000000000000000000000",
                  ticker: "ALPHA",
                  balance: "1000000000000000000",
                  costBasisUsdc: "20000000",
                  currentValueUsdc: "30000000",
                  unrealisedPnlUsdc: "10000000",
                  unrealisedPnlPct: 50,
                },
              ],
              realised: [
                {
                  token: "0xbbbb000000000000000000000000000000000000",
                  ticker: "BETA",
                  totalCostUsdc: "10000000",
                  totalProceedsUsdc: "18000000",
                  realisedPnlUsdc: "8000000",
                  realisedPnlPct: 80,
                },
              ],
            },
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({ ok: true, result: true }),
        { status: 200 },
      );
    });
    const h = makeBotHarness();
    await h.run(ppCallback(`pr:0:0:${WALLET}`));
    const edit = collectCalls(fetchSpy).find((c) =>
      c.url.includes("/editMessageText"),
    );
    expect(edit).toBeDefined();
    const editBody = edit!.body as {
      text: string;
      reply_markup: {
        inline_keyboard: { text: string; callback_data: string }[][];
      };
    };
    expect(editBody.text).toContain("ALPHA");
    expect(editBody.text).toContain("BETA");
    expect(editBody.text).toContain("+$8");
    const rows = editBody.reply_markup.inline_keyboard;
    expect(rows.at(-2)!.map((b) => b.text)).toEqual(["🔄 Refresh"]);
    const answer = collectCalls(fetchSpy).find((c) =>
      c.url.includes("/answerCallbackQuery"),
    );
    expect(answer?.body.text).toBe("Refreshed");
  });

  it("pr callback toasts 'invalid refresh request' when the wallet arg is not an address", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: true }), { status: 200 }),
    );
    const h = makeBotHarness();
    await h.run(ppCallback("pr:0:0:not-a-wallet"));
    const answer = collectCalls(fetchSpy).find((c) =>
      c.url.includes("/answerCallbackQuery"),
    );
    expect(answer?.body.text).toBe("Invalid refresh request.");
  });

  it("ACKs the callback (answerCallbackQuery) even when editMessageText fails (deleted msg / not modified)", async () => {
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/v1/bot/positions-v2/")) {
        return new Response(
          JSON.stringify({
            data: {
              open: Array.from({ length: 47 }, (_, i) => ({
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
    await h.run(ppCallback(`pp:1:0:${WALLET}`));
    const answer = collectCalls(fetchSpy).find((c) =>
      c.url.includes("/answerCallbackQuery"),
    );
    expect(answer).toBeDefined();
  });
});
