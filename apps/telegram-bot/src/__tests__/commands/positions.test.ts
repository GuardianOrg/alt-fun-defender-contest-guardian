import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { makeBotHarness } from "../helpers/bot.js";

const WALLET = "0x1234567890abcdef1234567890abcdef12345678";
const TOKEN = "0xaaaa000000000000000000000000000000000000";

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

const okFallback = () =>
  new Response(JSON.stringify({ ok: true, result: true }), { status: 200 });

describe("/positions", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("replies with usage when no wallet argument is provided", async () => {
    fetchSpy.mockResolvedValue(okFallback());
    const h = makeBotHarness();
    await h.run(positionsUpdate(""));
    const sent = sentMessages(fetchSpy);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain("Usage: /positions");
    expect(upstreamCalls(fetchSpy)).toHaveLength(0);
  });

  it("replies with an error when the wallet is not a 0x-address", async () => {
    fetchSpy.mockResolvedValue(okFallback());
    const h = makeBotHarness();
    await h.run(positionsUpdate("not-a-wallet"));
    const sent = sentMessages(fetchSpy);
    expect(sent[0]!.text.toLowerCase()).toContain("invalid wallet");
    expect(upstreamCalls(fetchSpy)).toHaveLength(0);
  });

  it("renders an empty-state message when the wallet holds no positions", async () => {
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/v1/bot/positions/")) {
        return new Response(
          JSON.stringify({ data: { open: [], realised: [] } }),
          { status: 200 },
        );
      }
      return okFallback();
    });
    const h = makeBotHarness();
    await h.run(positionsUpdate(WALLET));
    const sent = sentMessages(fetchSpy);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toBe("No open positions for this wallet.");
  });

  it("renders a single open position with ticker, balance, cost, value, PnL", async () => {
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/v1/bot/positions/")) {
        return new Response(
          JSON.stringify({
            data: {
              open: [
                {
                  token: TOKEN,
                  ticker: "ALPHA",
                  balance: "2500000000000000000",
                  costBasisUsdc: "50000000",
                  currentValueUsdc: "75000000",
                  unrealisedPnlUsdc: "25000000",
                  unrealisedPnlPct: 50,
                },
              ],
              realised: [],
            },
          }),
          { status: 200 },
        );
      }
      return okFallback();
    });
    const h = makeBotHarness();
    await h.run(positionsUpdate(WALLET));
    const sent = sentMessages(fetchSpy);
    expect(sent).toHaveLength(1);
    const text = sent[0]!.text;
    expect(text).toContain("Open positions (1)");
    expect(text).toContain("ALPHA");
    expect(text).toContain("2.5");
    expect(text).toContain("$50");
    expect(text).toContain("$75");
    expect(text).toContain("+$25");
    expect(text).toContain("+50.00%");
    expect(sent[0]!.reply_markup).toBeUndefined();
  });

  it("renders both Open and Realised sections when both have rows", async () => {
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/v1/bot/positions/")) {
        return new Response(
          JSON.stringify({
            data: {
              open: [
                {
                  token: TOKEN,
                  ticker: "ALPHA",
                  balance: "1000000000000000000",
                  costBasisUsdc: "20000000",
                  currentValueUsdc: "25000000",
                  unrealisedPnlUsdc: "5000000",
                  unrealisedPnlPct: 25,
                },
              ],
              realised: [
                {
                  token: "0xbbbb000000000000000000000000000000000000",
                  ticker: "BETA",
                  totalCostUsdc: "10000000",
                  totalProceedsUsdc: "15000000",
                  realisedPnlUsdc: "5000000",
                  realisedPnlPct: 50,
                },
              ],
            },
          }),
          { status: 200 },
        );
      }
      return okFallback();
    });
    const h = makeBotHarness();
    await h.run(positionsUpdate(WALLET));
    const sent = sentMessages(fetchSpy);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain("Open positions (1)");
    expect(sent[0]!.text).toContain("Realised positions (1)");
    expect(sent[0]!.text).toContain("ALPHA");
    expect(sent[0]!.text).toContain("BETA");
  });

  it("attaches a Next button when the response paginates", async () => {
    const open = Array.from({ length: 250 }, (_, i) => ({
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
          JSON.stringify({ data: { open, realised: [] } }),
          { status: 200 },
        );
      }
      return okFallback();
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
      return okFallback();
    });
    const h = makeBotHarness();
    await h.run(positionsUpdate(WALLET));
    const sent = sentMessages(fetchSpy);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text.toLowerCase()).toContain(
      "data temporarily unavailable",
    );
  });

  it("makes exactly one upstream request and forwards the bot X-API-Key", async () => {
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/v1/bot/positions/")) {
        return new Response(
          JSON.stringify({ data: { open: [], realised: [] } }),
          { status: 200 },
        );
      }
      return okFallback();
    });
    const h = makeBotHarness();
    await h.run(positionsUpdate(WALLET));
    const apiCalls = upstreamCalls(fetchSpy);
    // Single API call replaces the legacy /portfolio + /balances pair —
    // critical to keep per-/positions latency low under the bot fleet's
    // shared X-API-Key quota (see telegram-bot AGENTS.md "/positions").
    expect(apiCalls).toHaveLength(1);
    const headers = new Headers((apiCalls[0]![1] as RequestInit).headers);
    expect(headers.get("x-api-key")).toBe("test-api-key");
    expect(String(apiCalls[0]![0])).toContain("/api/v1/bot/positions/");
  });
});
