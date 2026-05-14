import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  makeBotHarness,
  withTelegramOk,
  type BotTestHarness,
} from "../helpers/bot.js";
import { START_CALLBACK } from "../../keyboards/start-menu.js";
import { renderTrackBody } from "../../commands/track.js";
import type { Trade, TokenInfo } from "../../lib/api.js";

const RPC_URL = "https://rpc.test.local";
const API_BASE = "https://api.test.local";

const TOKEN_ADDR = "0x1111111111111111111111111111111111111111";

const TOKEN_INFO_FIXTURE = {
  address: TOKEN_ADDR,
  name: "Test Token",
  ticker: "TEST",
  priceUsd: 0.001,
  mcapUsd: 5000,
  change24h: 5.2,
  ltChange24h: 2.1,
  volume24hUsd: 1234.56,
  curveFilled: 30,
  status: "curve",
};

const makeTrade = (i: number, isBuy = true): Trade => ({
  id: `t${i}`,
  tokenAddress: TOKEN_ADDR,
  trader: `0x${i.toString(16).padStart(40, "0")}`,
  isBuy,
  usdcAmount: String(100 * 1_000_000), // $100 USDC
  tokenAmount: String(BigInt(50) * 10n ** 18n), // 50 tokens
  blockNumber: String(1000 + i),
  timestamp: String(Math.floor(Date.now() / 1000) - i * 60),
});

const callbackUpdate = (data: string) => ({
  update_id: 1,
  callback_query: {
    id: "cbq-1",
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

const messageUpdate = (text: string, updateId = 2) => ({
  update_id: updateId,
  message: {
    message_id: updateId,
    date: 0,
    chat: { id: 42, type: "private" as const },
    from: { id: 7, is_bot: false, first_name: "Ada" },
    text,
    entities: text.startsWith("/")
      ? [
          {
            type: "bot_command" as const,
            offset: 0,
            length: text.split(/\s+/)[0]!.length,
          },
        ]
      : [],
  },
});

interface TgCall {
  url: string;
  body: Record<string, unknown>;
}

const capture = (fetchSpy: ReturnType<typeof vi.spyOn>): TgCall[] =>
  (fetchSpy.mock.calls as Array<[unknown, unknown?]>)
    .filter((call) => (call[1] as RequestInit | undefined)?.body !== undefined)
    .map((call) => ({
      url: String(call[0]),
      body: JSON.parse((call[1] as RequestInit).body as string) as Record<
        string,
        unknown
      >,
    }));

interface MockOpts {
  tokenFound?: boolean;
  tokenApiDown?: boolean;
  tradesApiDown?: boolean;
  trades?: Trade[];
  chartCandles?: Array<{
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
  }>;
}

const mockApi = (
  fetchSpy: ReturnType<typeof vi.spyOn>,
  opts: MockOpts = {},
): void => {
  const trades = opts.trades ?? [makeTrade(1, true), makeTrade(2, false)];
  withTelegramOk(fetchSpy, async (input) => {
    const url = String(input);
    if (url === RPC_URL) {
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: `0x${(0n).toString(16).padStart(64, "0")}`,
        }),
        { status: 200 },
      );
    }
    if (url.startsWith(API_BASE) && url.includes("/api/v1/tokens/")) {
      if (opts.tokenApiDown) return new Response("", { status: 503 });
      if (opts.tokenFound === false) {
        return new Response(JSON.stringify({ error: "not found" }), {
          status: 404,
        });
      }
      return new Response(
        JSON.stringify({ data: TOKEN_INFO_FIXTURE }),
        { status: 200 },
      );
    }
    if (url.startsWith(API_BASE) && url.includes("/api/v1/trades/")) {
      if (opts.tradesApiDown) return new Response("", { status: 503 });
      return new Response(JSON.stringify({ data: trades }), { status: 200 });
    }
    if (url.startsWith(API_BASE) && url.includes("/api/v1/chart/")) {
      // Chart is best-effort — default tests get an empty-candle response
      // so the renderer short-circuits to "no image" without needing the
      // resvg-wasm module to load in the node test env. Specific tests
      // can pass `chartCandles` to exercise the photo-send path.
      return new Response(
        JSON.stringify({
          data: {
            candles: opts.chartCandles ?? [],
            currentRatio: 1,
            currentExchangeRate: 1,
          },
        }),
        { status: 200 },
      );
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
};

const harness = (): BotTestHarness => {
  const h = makeBotHarness();
  h.env.HYPEREVM_RPC_URL = RPC_URL;
  return h;
};

describe("renderTrackBody (pure)", () => {
  const token = TOKEN_INFO_FIXTURE as TokenInfo;

  it("includes the token card and a recent trades section", () => {
    const html = renderTrackBody(token, [makeTrade(1, true)], 1_700_000_000);
    expect(html).toContain("Test Token");
    expect(html).toContain("TEST");
    expect(html).toContain("Recent trades");
    expect(html).toContain("BUY");
  });

  it("renders the empty-state when there are no trades", () => {
    const html = renderTrackBody(token, [], 1_700_000_000);
    expect(html).toContain("No trades yet");
  });

  it("caps the trade list at 20 rows even when more are returned", () => {
    const many = Array.from({ length: 50 }, (_, i) => makeTrade(i + 1, i % 2 === 0));
    const html = renderTrackBody(token, many, 1_700_000_000);
    const rowCount = (html.match(/(🟢 BUY|🔴 SELL)/g) ?? []).length;
    expect(rowCount).toBe(20);
  });

  it("formats buy and sell sides with distinct markers", () => {
    const html = renderTrackBody(
      token,
      [makeTrade(1, true), makeTrade(2, false)],
      1_700_000_000,
    );
    expect(html).toContain("🟢 BUY");
    expect(html).toContain("🔴 SELL");
  });
});

describe("/track command", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("Track start-menu button enters the lookup conversation (no hint toast)", async () => {
    const h = harness();
    mockApi(fetchSpy);
    await h.run(callbackUpdate(START_CALLBACK.track));

    const calls = capture(fetchSpy);
    const answer = calls.find((c) => c.url.includes("/answerCallbackQuery"));
    const send = calls.find((c) => c.url.includes("/sendMessage"));
    expect(answer!.body.show_alert).toBeFalsy();
    expect(send).toBeDefined();
    expect(String(send!.body.text)).toMatch(/contract address|alt\.fun/i);
  });

  it("token-address prompt carries the [← Back] [🏠 Home] nav row", async () => {
    const h = harness();
    mockApi(fetchSpy);
    await h.run(callbackUpdate(START_CALLBACK.track));

    const send = capture(fetchSpy).find((c) =>
      c.url.includes("/sendMessage"),
    );
    expect(send).toBeDefined();
    expect(String(send!.body.text)).toMatch(/Tap Home to exit/);
    const kb =
      (send!.body.reply_markup as
        | { inline_keyboard?: Array<Array<{ text: string; callback_data?: string }>> }
        | undefined)?.inline_keyboard ?? [];
    expect(
      kb.some((row) =>
        row.some((b) => b.callback_data === "nav:h") &&
        row.some((b) => b.callback_data === "nav:b"),
      ),
    ).toBe(true);
  });

  it("renders the track card and recent trades for a valid address", async () => {
    const h = harness();
    mockApi(fetchSpy);

    await h.run(callbackUpdate(START_CALLBACK.track));
    fetchSpy.mockClear();
    mockApi(fetchSpy);

    await h.run(messageUpdate(TOKEN_ADDR, 10));

    const calls = capture(fetchSpy);
    const send = calls.find((c) => c.url.includes("/sendMessage"));
    expect(send).toBeDefined();
    const text = String(send!.body.text);
    expect(text).toContain("Test Token");
    expect(text).toContain("Recent trades");

    const keyboard = (send!.body.reply_markup as {
      inline_keyboard?: Array<Array<{ text: string; url?: string }>>;
    })?.inline_keyboard ?? [];
    const allBtns = keyboard.flat();
    expect(allBtns.some((b) => b.text.includes("Buy"))).toBe(true);
    expect(allBtns.some((b) => b.text.includes("Sell"))).toBe(true);
    const altFun = allBtns.find((b) => b.text.includes("Open on Alt Fun"));
    expect(altFun?.url).toBe(`https://alt.fun/token/${TOKEN_ADDR}`);
  });

  it("`/track <addr>` renders the card directly without the prompt", async () => {
    const h = harness();
    mockApi(fetchSpy);

    await h.run(messageUpdate(`/track ${TOKEN_ADDR}`, 10));

    const calls = capture(fetchSpy);
    const sends = calls.filter((c) => c.url.includes("/sendMessage"));
    expect(sends).toHaveLength(1);
    const text = String(sends[0]!.body.text);
    expect(text).toContain("Test Token");
    expect(text).not.toMatch(/Enter the token contract address/i);
  });

  it("falls back to the lookup prompt when /track has no arg", async () => {
    const h = harness();
    mockApi(fetchSpy);

    await h.run(messageUpdate("/track", 10));

    const calls = capture(fetchSpy);
    const send = calls.find((c) => c.url.includes("/sendMessage"));
    expect(String(send!.body.text)).toMatch(/Enter the token contract address/i);
  });

  it("re-prompts on a garbage input that contains no address", async () => {
    const h = harness();
    mockApi(fetchSpy);

    await h.run(callbackUpdate(START_CALLBACK.track));
    fetchSpy.mockClear();
    mockApi(fetchSpy);

    await h.run(messageUpdate("not an address at all", 10));

    const calls = capture(fetchSpy);
    const send = calls.find((c) => c.url.includes("/sendMessage"));
    expect(String(send!.body.text)).toMatch(/Token not found|contract address/i);
  });

  it("aborts (not loops) with the outage copy when the token API is 503", async () => {
    const h = harness();
    mockApi(fetchSpy);

    await h.run(callbackUpdate(START_CALLBACK.track));
    fetchSpy.mockClear();
    mockApi(fetchSpy, { tokenApiDown: true });

    await h.run(messageUpdate(TOKEN_ADDR, 10));

    const calls = capture(fetchSpy);
    const sends = calls.filter((c) => c.url.includes("/sendMessage"));
    expect(sends).toHaveLength(1);
    expect(String(sends[0]!.body.text)).toMatch(/unavailable|try again/i);
  });

  it("still renders the card when the trades API is 503 (graceful degrade)", async () => {
    const h = harness();
    mockApi(fetchSpy);

    await h.run(callbackUpdate(START_CALLBACK.track));
    fetchSpy.mockClear();
    mockApi(fetchSpy, { tradesApiDown: true });

    await h.run(messageUpdate(TOKEN_ADDR, 10));

    const calls = capture(fetchSpy);
    const send = calls.find((c) => c.url.includes("/sendMessage"));
    expect(send).toBeDefined();
    const text = String(send!.body.text);
    expect(text).toContain("Test Token");
    expect(text).toContain("No trades yet");
  });

  it("Buy button on the track card sends a buy token card (no wallet needed)", async () => {
    const h = harness();
    mockApi(fetchSpy);
    await h.run(callbackUpdate(`trkb:${TOKEN_ADDR}`));

    const calls = capture(fetchSpy);
    const send = calls.find((c) => c.url.includes("/sendMessage"));
    expect(send).toBeDefined();
    const keyboard = (send!.body.reply_markup as {
      inline_keyboard?: Array<Array<{ text: string }>>;
    })?.inline_keyboard ?? [];
    const allBtns = keyboard.flat();
    expect(allBtns.some((b) => b.text.includes("Buy 20"))).toBe(true);
  });

  it("still sends the text card when the chart fetch hangs past the timeout", async () => {
    const h = harness();
    // Hold the chart endpoint open past CHART_TIMEOUT_MS so the race
    // resolves to null on the timer side. The token + trades fetches
    // still come back fast, so the text reply must go out without
    // waiting on the chart. Real timers — vitest's fakeTimers would
    // also have to drive the timeout we're testing, complicating the
    // setup. 5.5s is safely past CHART_TIMEOUT_MS = 5s.
    h.env.HYPEREVM_RPC_URL = RPC_URL;
    let chartResolver: (() => void) | undefined;
    withTelegramOk(fetchSpy, async (input) => {
      const url = String(input);
      if (url === RPC_URL) {
        return new Response(
          JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x00" }),
          { status: 200 },
        );
      }
      if (url.startsWith(API_BASE) && url.includes("/api/v1/tokens/")) {
        return new Response(JSON.stringify({ data: TOKEN_INFO_FIXTURE }), {
          status: 200,
        });
      }
      if (url.startsWith(API_BASE) && url.includes("/api/v1/trades/")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (url.startsWith(API_BASE) && url.includes("/api/v1/chart/")) {
        await new Promise<void>((resolve) => {
          chartResolver = resolve;
        });
        return new Response(JSON.stringify({ data: { candles: [] } }), {
          status: 200,
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    await h.run(messageUpdate(`/track ${TOKEN_ADDR}`, 11));

    const calls = capture(fetchSpy);
    const send = calls.find((c) => c.url.includes("/sendMessage"));
    expect(send).toBeDefined();
    expect(String(send!.body.text)).toContain("Test Token");
    // Release the hung chart fetch so vitest can exit cleanly.
    chartResolver?.();
  }, 10_000);

  it("Sell button on the track card sends a sell token card", async () => {
    const h = harness();
    mockApi(fetchSpy);
    await h.run(callbackUpdate(`trks:${TOKEN_ADDR}`));

    const calls = capture(fetchSpy);
    const send = calls.find((c) => c.url.includes("/sendMessage"));
    expect(send).toBeDefined();
    const keyboard = (send!.body.reply_markup as {
      inline_keyboard?: Array<Array<{ text: string }>>;
    })?.inline_keyboard ?? [];
    const allBtns = keyboard.flat();
    expect(allBtns.some((b) => b.text === "Sell 100%")).toBe(true);
  });
});
