import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { makeBotHarness, type BotTestHarness } from "../helpers/bot.js";
import { WalletManager } from "../../lib/wallet.js";

const ZERO_MASTER_KEY = btoa("\0".repeat(32));

const WALLET = "0x1234567890abcdef1234567890abcdef12345678";
const TOKEN = "0xaaaa000000000000000000000000000000000000";

const positionsUpdate = (
  args: string,
  chatType: "private" | "group" = "private",
) => {
  const text = `/positions${args ? ` ${args}` : ""}`;
  return {
    update_id: 1,
    message: {
      message_id: 1,
      date: 0,
      chat: { id: 42, type: chatType },
      from: { id: 7, is_bot: false, first_name: "Ada" },
      text,
      entities: [{ type: "bot_command", offset: 0, length: 10 }],
    },
  };
};

const seedActiveWallet = async (h: BotTestHarness): Promise<string> => {
  const wm = new WalletManager(
    h.kv as unknown as KVNamespace,
    ZERO_MASTER_KEY,
  );
  const w = await wm.createWallet(7);
  return w.address;
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

  it("replies with usage when no wallet argument is provided in a group chat", async () => {
    // Active-wallet fallback is private-DM only — outside a DM we
    // refuse to resolve the user's custodial address even if they have
    // one, since leaking it into a group transcript is the exact thing
    // the gate exists to prevent.
    fetchSpy.mockResolvedValue(okFallback());
    const h = makeBotHarness();
    await seedActiveWallet(h);
    await h.run(positionsUpdate("", "group"));
    const sent = sentMessages(fetchSpy);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain("Usage: /positions");
    expect(upstreamCalls(fetchSpy)).toHaveLength(0);
  });

  it("falls back to the active wallet in a private chat when no argument is given", async () => {
    const h = makeBotHarness();
    const activeAddress = await seedActiveWallet(h);
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
    await h.run(positionsUpdate(""));
    const sent = sentMessages(fetchSpy);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toBe("No open positions for this wallet.");
    const apiCalls = upstreamCalls(fetchSpy);
    expect(apiCalls).toHaveLength(1);
    expect(String(apiCalls[0]![0]).toLowerCase()).toContain(
      activeAddress.toLowerCase(),
    );
  });

  it("replies with no-active-wallet copy when the user has no wallet yet", async () => {
    fetchSpy.mockResolvedValue(okFallback());
    const h = makeBotHarness();
    await h.run(positionsUpdate(""));
    const sent = sentMessages(fetchSpy);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain("No active wallet");
    expect(sent[0]!.text).toContain("/wallet");
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
    // A single open position with no pagination still attaches a
    // [Buy ALPHA] [Sell ALPHA] row.
    const markup = sent[0]!.reply_markup as
      | { inline_keyboard: { text: string; callback_data: string }[][] }
      | undefined;
    expect(markup).toBeDefined();
    expect(markup!.inline_keyboard).toHaveLength(1);
    expect(markup!.inline_keyboard[0]!.map((b) => b.text)).toEqual([
      "Buy ALPHA",
      "Sell ALPHA",
    ]);
    expect(markup!.inline_keyboard[0]![0]!.callback_data).toBe(`pob:${TOKEN}`);
    expect(markup!.inline_keyboard[0]![1]!.callback_data).toBe(`pos:${TOKEN}`);
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
    // Each open position on the page contributes a [Buy] [Sell] row;
    // the pagination nav row is the last entry in the keyboard.
    const nav = markup.inline_keyboard[markup.inline_keyboard.length - 1]!;
    expect(nav.map((b) => b.text)).toEqual(["Next →"]);
    expect(nav[0]!.callback_data).toMatch(/^pp:1:0x[0-9a-f]{40}$/i);
    // Sanity check: the per-position rows above the nav follow the
    // `pob:<addr>` / `pos:<addr>` shape.
    for (const row of markup.inline_keyboard.slice(0, -1)) {
      expect(row).toHaveLength(2);
      expect(row[0]!.callback_data).toMatch(/^pob:0x[0-9a-f]{40}$/i);
      expect(row[1]!.callback_data).toMatch(/^pos:0x[0-9a-f]{40}$/i);
    }
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

const positionBuyCallback = (token: string) => ({
  update_id: 20,
  callback_query: {
    id: "cbq-buy",
    from: { id: 7, is_bot: false, first_name: "Ada" },
    chat_instance: "instance-1",
    data: `pob:${token}`,
    message: {
      message_id: 99,
      date: 0,
      chat: { id: 42, type: "private" as const },
    },
  },
});

const positionSellCallback = (token: string) => ({
  update_id: 21,
  callback_query: {
    id: "cbq-sell",
    from: { id: 7, is_bot: false, first_name: "Ada" },
    chat_instance: "instance-1",
    data: `pos:${token}`,
    message: {
      message_id: 99,
      date: 0,
      chat: { id: 42, type: "private" as const },
    },
  },
});

const mockTokenApi = (
  fetchSpy: ReturnType<typeof vi.spyOn>,
  token: string,
): void => {
  fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes(`/api/v1/tokens/${token}`)) {
      return new Response(
        JSON.stringify({
          data: {
            address: token,
            name: "Test Token",
            ticker: "ALPHA",
            priceUsd: 0.05,
            mcapUsd: 50_000,
            change24h: 12.5,
            ltChange24h: null,
            volume24hUsd: 1000,
            curveFilled: 0.42,
            status: "curve",
            ltPair: null,
          },
        }),
        { status: 200 },
      );
    }
    return okFallback();
  });
};

describe("/positions per-position buy/sell callbacks", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("pob:<token> replies with a buy card pre-loaded for the selected token", async () => {
    mockTokenApi(fetchSpy, TOKEN);
    const h = makeBotHarness();
    await h.run(positionBuyCallback(TOKEN));
    const sent = sentMessages(fetchSpy);
    expect(sent).toHaveLength(1);
    const markup = sent[0]!.reply_markup as
      | { inline_keyboard: { text: string; callback_data: string }[][] }
      | undefined;
    expect(markup).toBeDefined();
    const allButtons = markup!.inline_keyboard.flat();
    // Buy card keyboard exposes the standard quick-buy amounts.
    expect(allButtons.some((b) => b.text.includes("Buy 20"))).toBe(true);
    // Token address survives the round-trip in every action's callback.
    for (const b of allButtons) {
      if (b.callback_data.startsWith("bt"))
        expect(b.callback_data.endsWith(TOKEN)).toBe(true);
    }
  });

  it("pos:<token> replies with a sell card pre-loaded for the selected token", async () => {
    mockTokenApi(fetchSpy, TOKEN);
    const h = makeBotHarness();
    await h.run(positionSellCallback(TOKEN));
    const sent = sentMessages(fetchSpy);
    expect(sent).toHaveLength(1);
    const markup = sent[0]!.reply_markup as
      | { inline_keyboard: { text: string; callback_data: string }[][] }
      | undefined;
    expect(markup).toBeDefined();
    const allButtons = markup!.inline_keyboard.flat();
    expect(allButtons.some((b) => b.text.includes("Sell All"))).toBe(true);
    for (const b of allButtons) {
      if (b.callback_data.startsWith("bts"))
        expect(b.callback_data.endsWith(TOKEN)).toBe(true);
    }
  });

  it("toasts the outage copy when the token API is down", async () => {
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).startsWith("https://api.test.local")) {
        return new Response("{}", { status: 503 });
      }
      return okFallback();
    });
    const h = makeBotHarness();
    await h.run(positionBuyCallback(TOKEN));
    const calls = (fetchSpy.mock.calls as Array<[unknown, unknown?]>)
      .filter((c) => typeof (c[1] as RequestInit)?.body === "string")
      .map((c) => ({
        url: String(c[0]),
        body: JSON.parse((c[1] as RequestInit).body as string) as Record<
          string,
          unknown
        >,
      }));
    const answer = calls.find((c) => c.url.includes("/answerCallbackQuery"));
    expect(String(answer?.body.text)).toContain("Data temporarily unavailable");
  });
});
