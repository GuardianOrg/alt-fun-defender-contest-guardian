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
  parse_mode?: string;
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

  it("renders a single open position with ticker, balance, cost, value, PnL, and a per-position [Buy] / [Sell] callback row", async () => {
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
    expect(sent[0]!.parse_mode).toBe("HTML");
    // Regression: the legacy `t.me?start=buy_<addr>` anchors bounced
    // through Telegram's link-handler UI even inside the same bot's
    // chat. Per-position callback buttons replace them so the action
    // card lands inline in the same chat.
    expect(text).not.toContain("?start=buy_");
    expect(text).not.toContain("?start=sell_");
    expect(text).not.toContain("t.me/");
    const markup = sent[0]!.reply_markup as {
      inline_keyboard: { text: string; callback_data: string }[][];
    };
    expect(markup).toBeDefined();
    // One action row + trailing Close row.
    expect(markup.inline_keyboard).toHaveLength(2);
    const row = markup.inline_keyboard[0]!;
    expect(row.map((b) => b.text)).toEqual(["Buy ALPHA", "Sell ALPHA"]);
    expect(row[0]!.callback_data).toBe(`pb:${TOKEN}`);
    expect(row[1]!.callback_data).toBe(`ps:${TOKEN}`);
    expect(markup.inline_keyboard.at(-1)!.map((b) => b.text)).toEqual([
      "Close",
    ]);
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

  it("attaches per-position [Buy] / [Sell] rows + a nav row when the response paginates", async () => {
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
    // Multiple per-position rows + a nav row + a trailing Close row.
    expect(markup.inline_keyboard.length).toBeGreaterThan(2);
    const closeRow = markup.inline_keyboard[markup.inline_keyboard.length - 1]!;
    expect(closeRow.map((b) => b.text)).toEqual(["Close"]);
    const nav = markup.inline_keyboard[markup.inline_keyboard.length - 2]!;
    expect(nav.map((b) => b.text)).toEqual(["Next →"]);
    expect(nav[0]!.callback_data).toMatch(/^pp:1:0x[0-9a-f]{40}$/i);
    // Every non-nav row must be a Buy/Sell pair with `pb:` / `ps:` data.
    for (let i = 0; i < markup.inline_keyboard.length - 2; i++) {
      const row = markup.inline_keyboard[i]!;
      expect(row).toHaveLength(2);
      expect(row[0]!.text.startsWith("Buy ")).toBe(true);
      expect(row[1]!.text.startsWith("Sell ")).toBe(true);
      expect(row[0]!.callback_data.startsWith("pb:0x")).toBe(true);
      expect(row[1]!.callback_data.startsWith("ps:0x")).toBe(true);
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

