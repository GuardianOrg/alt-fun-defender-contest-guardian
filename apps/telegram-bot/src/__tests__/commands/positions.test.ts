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
      if (url.includes("/api/v1/bot/positions-v2/")) {
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
    expect(sent[0]!.text).toContain("No open positions for this wallet.");
    expect(sent[0]!.text).toContain(
      "This bot will never ask for your seed phrase or private key via DM.",
    );
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
      if (url.includes("/api/v1/bot/positions-v2/")) {
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
    expect(sent[0]!.text).toContain("No open positions for this wallet.");
    expect(sent[0]!.text).toContain(
      "This bot will never ask for your seed phrase or private key via DM.",
    );
  });

  it("renders a single open position with deeplinked ticker, balance, cost, value, PnL, and Open Pos label row (no per-position buy/sell buttons)", async () => {
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/v1/bot/positions-v2/")) {
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
    // The ticker on the body line is a `t.me/<bot>?start=track_<addr>`
    // deeplink — tap it to bounce back into the bot's chat on a fresh
    // /track card. No buy/sell deeplinks or callback buttons surface.
    expect(text).toContain(
      `<a href="https://t.me/trade_cortisol_bot?start=track_${TOKEN}">ALPHA</a>`,
    );
    expect(text).not.toContain("?start=buy_");
    expect(text).not.toContain("?start=sell_");
    const markup = sent[0]!.reply_markup as {
      inline_keyboard: { text: string; callback_data: string }[][];
    };
    expect(markup).toBeDefined();
    // Open Pos label row + refresh row + trailing Back/Home row.
    expect(markup.inline_keyboard).toHaveLength(3);
    expect(markup.inline_keyboard[0]!.map((b) => b.text)).toEqual([
      "Page 1/1 Open Pos",
    ]);
    expect(markup.inline_keyboard[0]![0]!.callback_data).toBe(
      `pp:0:0:${WALLET}`,
    );
    // No per-position Buy/Sell buttons remain anywhere in the keyboard.
    for (const b of markup.inline_keyboard.flat()) {
      expect(b.callback_data.startsWith("pb:")).toBe(false);
      expect(b.callback_data.startsWith("ps:")).toBe(false);
    }
    expect(markup.inline_keyboard.at(-2)!.map((b) => b.text)).toEqual([
      "🔄 Refresh",
    ]);
    expect(markup.inline_keyboard.at(-2)![0]!.callback_data).toBe(
      `pr:0:0:${WALLET}`,
    );
    expect(markup.inline_keyboard.at(-1)!.map((b) => b.text)).toEqual([
      "← Back",
      "🏠 Home",
    ]);
  });

  it("renders both Open and Realised sections when both have rows", async () => {
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/v1/bot/positions-v2/")) {
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
    expect(sent[0]!.text).toContain("Realized positions (1)");
    expect(sent[0]!.text).toContain("ALPHA");
    expect(sent[0]!.text).toContain("BETA");
  });

  it("attaches the Open Pos nav row above Refresh/Back/Home when the open section paginates", async () => {
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
      if (url.includes("/api/v1/bot/positions-v2/")) {
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
    const markup = sent[0]!.reply_markup as {
      inline_keyboard: { text: string; callback_data: string }[][];
    };
    expect(markup).toBeDefined();
    // Open-nav row + refresh row + Back/Home row.
    expect(markup.inline_keyboard).toHaveLength(3);
    const nav = markup.inline_keyboard[0]!;
    expect(nav.map((b) => b.text)).toEqual(["→ Page 2/50 Open Pos"]);
    expect(nav[0]!.callback_data).toMatch(/^pp:1:0:0x[0-9a-f]{40}$/i);
    expect(markup.inline_keyboard[1]!.map((b) => b.text)).toEqual([
      "🔄 Refresh",
    ]);
    expect(markup.inline_keyboard[1]![0]!.callback_data).toMatch(
      /^pr:0:0:0x[0-9a-f]{40}$/i,
    );
    expect(markup.inline_keyboard[2]!.map((b) => b.text)).toEqual([
      "← Back",
      "🏠 Home",
    ]);
    // No buy/sell callbacks remain anywhere in the keyboard.
    for (const b of markup.inline_keyboard.flat()) {
      expect(b.callback_data.startsWith("pb:")).toBe(false);
      expect(b.callback_data.startsWith("ps:")).toBe(false);
    }
    // Only the ticker anchors point at `t.me/<bot>?start=track_<addr>`.
    expect(sent[0]!.text).not.toContain("?start=buy_");
    expect(sent[0]!.text).not.toContain("?start=sell_");
    expect(sent[0]!.text).toContain("?start=track_");
  });

  it("replies with a degraded-data message + back/home row when the API returns 503", async () => {
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
    // Users land on the outage reply with no other affordance — without
    // a [← Back] [🏠 Home] row they have to retype /start to escape.
    const markup = sent[0]!.reply_markup as
      | { inline_keyboard: { text: string; callback_data: string }[][] }
      | undefined;
    expect(markup?.inline_keyboard).toBeDefined();
    const lastRow = markup!.inline_keyboard[markup!.inline_keyboard.length - 1]!;
    expect(lastRow.map((b) => b.text)).toEqual(["← Back", "🏠 Home"]);
  });

  it("makes exactly one upstream request and forwards the bot X-API-Key", async () => {
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/v1/bot/positions-v2/")) {
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
    expect(String(apiCalls[0]![0])).toContain("/api/v1/bot/positions-v2/");
  });
});

