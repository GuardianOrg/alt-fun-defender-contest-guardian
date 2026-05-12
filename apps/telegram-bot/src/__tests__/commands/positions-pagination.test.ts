import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { makeBotHarness } from "../helpers/bot.js";

const WALLET = "0x1234567890abcdef1234567890abcdef12345678";

const mockApi = (
  fetchSpy: ReturnType<typeof vi.spyOn>,
  positions: number,
  balances: number,
): void => {
  const port = Array.from({ length: positions }, (_, i) => ({
    tokenAddress: `0x${i.toString(16).padStart(40, "0")}`,
    tokenAmount: "0",
    costBasisUsdc: "1000000",
  }));
  const bal = Array.from({ length: balances }, (_, i) => ({
    address: `0x${i.toString(16).padStart(40, "0")}`,
    name: `Long Token Name Number ${i}`,
    ticker: `LT${i}`,
    ltPair: "0xbbbb",
    leverage: 2,
    underlying: "HYPE",
    ltDirection: "long",
    balance: "1000000000000000000",
  }));
  fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/v1/portfolio/")) {
      return new Response(
        JSON.stringify({ data: { positions: port, approximate: false } }),
        { status: 200 },
      );
    }
    if (url.includes("/api/v1/balances/")) {
      return new Response(JSON.stringify({ data: bal }), { status: 200 });
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

  it("edits the originating message with the requested page content + keyboard", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: true }), { status: 200 }),
    );
    mockApi(fetchSpy, 250, 250);
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
      reply_markup: {
        inline_keyboard: { text: string; callback_data: string }[][];
      };
    };
    expect(body.chat_id).toBe(42);
    expect(body.message_id).toBe(99);
    expect(body.text).toContain("Page 2 of");
    const buttons = body.reply_markup.inline_keyboard.flat();
    const texts = buttons.map((b) => b.text);
    expect(texts).toContain("← Prev");
    if (texts.length > 1) expect(texts).toContain("Next →");
    for (const b of buttons) {
      expect(b.callback_data).toMatch(/^pp:\d+:0x[0-9a-f]{40}$/i);
    }
  });

  it("clamps to the last available page when positions have shrunk since the button was rendered", async () => {
    mockApi(fetchSpy, 1, 1);
    const h = makeBotHarness();
    await h.run(ppCallback(`pp:99:${WALLET}`));
    const editCalls = collectCalls(fetchSpy).filter((c) =>
      c.url.includes("/editMessageText"),
    );
    expect(editCalls).toHaveLength(1);
    const body = editCalls[0]!.body as {
      text: string;
      reply_markup?: unknown;
    };
    // Single page → no "Page X of Y" footer, no keyboard.
    expect(body.text).not.toContain("Page ");
    expect(body.reply_markup).toBeUndefined();
  });

  it("ACKs the callback (answerCallbackQuery) even when editMessageText fails (deleted msg / not modified)", async () => {
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/v1/portfolio/")) {
        return new Response(
          JSON.stringify({
            data: {
              positions: Array.from({ length: 250 }, (_, i) => ({
                tokenAddress: `0x${i.toString(16).padStart(40, "0")}`,
                tokenAmount: "0",
                costBasisUsdc: "1000000",
              })),
              approximate: false,
            },
          }),
          { status: 200 },
        );
      }
      if (url.includes("/api/v1/balances/")) {
        return new Response(
          JSON.stringify({
            data: Array.from({ length: 250 }, (_, i) => ({
              address: `0x${i.toString(16).padStart(40, "0")}`,
              name: `LT ${i}`,
              ticker: `LT${i}`,
              ltPair: "0xbbbb",
              leverage: 2,
              underlying: "HYPE",
              ltDirection: "long",
              balance: "1000000000000000000",
            })),
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
