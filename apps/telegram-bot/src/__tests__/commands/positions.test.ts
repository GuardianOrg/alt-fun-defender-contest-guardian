import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { makeBotHarness } from "../helpers/bot.js";

const WALLET = "0x1234567890abcdef1234567890abcdef12345678";

const positionsUpdate = (args: string) => {
  const text = `/positions${args ? ` ${args}` : ""}`;
  return {
    update_id: 1,
    message: {
      message_id: 1,
      date: 0,
      chat: { id: 42, type: "private" },
      from: { id: 7, is_bot: false, first_name: "Ada" },
      text,
      entities: [{ type: "bot_command", offset: 0, length: 10 }],
    },
  };
};

interface SentMessage {
  chat_id: number;
  text: string;
  reply_markup?: unknown;
}

const sentMessages = (fetchSpy: ReturnType<typeof vi.spyOn>): SentMessage[] =>
  (fetchSpy.mock.calls as Array<[unknown, unknown?]>)
    .filter((call) => String(call[0]).includes("/sendMessage"))
    .map(
      (call) =>
        JSON.parse(
          (call[1] as RequestInit).body as string,
        ) as SentMessage,
    );

const upstreamCalls = (fetchSpy: ReturnType<typeof vi.spyOn>) =>
  (fetchSpy.mock.calls as Array<[unknown, unknown?]>).filter((call) =>
    String(call[0]).startsWith("https://api.test.local"),
  );

describe("/positions", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("replies with usage when no wallet argument is provided", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: true }), { status: 200 }),
    );
    const h = makeBotHarness();
    await h.run(positionsUpdate(""));
    const sent = sentMessages(fetchSpy);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain("Usage: /positions");
    expect(upstreamCalls(fetchSpy)).toHaveLength(0);
  });

  it("replies with an error when the wallet is not a 0x-address", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: true }), { status: 200 }),
    );
    const h = makeBotHarness();
    await h.run(positionsUpdate("not-a-wallet"));
    const sent = sentMessages(fetchSpy);
    expect(sent[0]!.text.toLowerCase()).toContain("invalid wallet");
    expect(upstreamCalls(fetchSpy)).toHaveLength(0);
  });

  it("renders an empty-state message when the wallet holds no positions", async () => {
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/v1/portfolio/")) {
        return new Response(
          JSON.stringify({ data: { positions: [], approximate: false } }),
          { status: 200 },
        );
      }
      if (url.includes("/api/v1/balances/")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      // Fallback (includes Telegram API calls in the bot pathway):
      // grammY expects `{ ok: true, result: ... }` and treats a bare
      // `{}` as a failed call. Returning the ok-envelope keeps grammY
      // happy while tests assert on the request side.
      return new Response(
        JSON.stringify({ ok: true, result: true }),
        { status: 200 },
      );
    });
    const h = makeBotHarness();
    await h.run(positionsUpdate(WALLET));
    const sent = sentMessages(fetchSpy);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toBe("No open positions for this wallet.");
  });

  it("renders joined positions when both endpoints return data", async () => {
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/v1/portfolio/")) {
        return new Response(
          JSON.stringify({
            data: {
              positions: [
                {
                  tokenAddress: "0xaaaa000000000000000000000000000000000000",
                  tokenAmount: "0",
                  costBasisUsdc: "50000000",
                },
              ],
              approximate: false,
            },
          }),
          { status: 200 },
        );
      }
      if (url.includes("/api/v1/balances/")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                address: "0xAAAA000000000000000000000000000000000000",
                name: "Alpha Token",
                ticker: "ALPHA",
                ltPair: "0xbbbb",
                leverage: 2,
                underlying: "HYPE",
                ltDirection: "long",
                balance: "2500000000000000000",
              },
            ],
          }),
          { status: 200 },
        );
      }
      // Fallback (includes Telegram API calls in the bot pathway):
      // grammY expects `{ ok: true, result: ... }` and treats a bare
      // `{}` as a failed call. Returning the ok-envelope keeps grammY
      // happy while tests assert on the request side.
      return new Response(
        JSON.stringify({ ok: true, result: true }),
        { status: 200 },
      );
    });
    const h = makeBotHarness();
    await h.run(positionsUpdate(WALLET));
    const sent = sentMessages(fetchSpy);
    expect(sent).toHaveLength(1);
    const text = sent[0]!.text;
    expect(text).toContain("Open positions (1)");
    expect(text).toContain("Alpha Token (ALPHA)");
    expect(text).toContain("2.5");
    expect(text).toContain("$50");
    expect(sent[0]!.reply_markup).toBeUndefined();
  });

  it("attaches a Next button when the response paginates", async () => {
    const positions = Array.from({ length: 250 }, (_, i) => ({
      tokenAddress: `0x${i.toString(16).padStart(40, "0")}`,
      tokenAmount: "0",
      costBasisUsdc: "1000000",
    }));
    const balances = Array.from({ length: 250 }, (_, i) => ({
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
          JSON.stringify({ data: { positions, approximate: false } }),
          { status: 200 },
        );
      }
      if (url.includes("/api/v1/balances/")) {
        return new Response(JSON.stringify({ data: balances }), {
          status: 200,
        });
      }
      // Fallback (includes Telegram API calls in the bot pathway):
      // grammY expects `{ ok: true, result: ... }` and treats a bare
      // `{}` as a failed call. Returning the ok-envelope keeps grammY
      // happy while tests assert on the request side.
      return new Response(
        JSON.stringify({ ok: true, result: true }),
        { status: 200 },
      );
    });
    const h = makeBotHarness();
    await h.run(positionsUpdate(WALLET));
    const sent = sentMessages(fetchSpy);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain("Open positions (250)");
    expect(sent[0]!.text).toContain("Page 1 of");
    const markup = sent[0]!.reply_markup as {
      inline_keyboard: { text: string; callback_data: string }[][];
    };
    expect(markup).toBeDefined();
    const buttons = markup.inline_keyboard.flat();
    expect(buttons.map((b) => b.text)).toEqual(["Next →"]);
    expect(buttons[0]!.callback_data).toMatch(/^pp:1:0x[0-9a-f]{40}$/i);
  });

  it("replies with a degraded-data message when the API returns 503", async () => {
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("https://api.test.local")) {
        return new Response("{}", { status: 503 });
      }
      // Fallback (includes Telegram API calls in the bot pathway):
      // grammY expects `{ ok: true, result: ... }` and treats a bare
      // `{}` as a failed call. Returning the ok-envelope keeps grammY
      // happy while tests assert on the request side.
      return new Response(
        JSON.stringify({ ok: true, result: true }),
        { status: 200 },
      );
    });
    const h = makeBotHarness();
    await h.run(positionsUpdate(WALLET));
    const sent = sentMessages(fetchSpy);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text.toLowerCase()).toContain(
      "data temporarily unavailable",
    );
  });

  it("sends the bot's X-API-Key on every upstream read", async () => {
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/v1/portfolio/")) {
        return new Response(
          JSON.stringify({ data: { positions: [], approximate: false } }),
          { status: 200 },
        );
      }
      if (url.includes("/api/v1/balances/")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      // Fallback (includes Telegram API calls in the bot pathway):
      // grammY expects `{ ok: true, result: ... }` and treats a bare
      // `{}` as a failed call. Returning the ok-envelope keeps grammY
      // happy while tests assert on the request side.
      return new Response(
        JSON.stringify({ ok: true, result: true }),
        { status: 200 },
      );
    });
    const h = makeBotHarness();
    await h.run(positionsUpdate(WALLET));
    const apiCalls = upstreamCalls(fetchSpy);
    expect(apiCalls).toHaveLength(2);
    for (const call of apiCalls) {
      const headers = new Headers((call[1] as RequestInit).headers);
      expect(headers.get("x-api-key")).toBe("test-api-key");
    }
  });
});
