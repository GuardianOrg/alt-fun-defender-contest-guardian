import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Stub the chart builder so we never load the resvg-wasm module from
// vitest. Defaulting to `null` (no chart) keeps the pt:` handler on the
// pure-text edit path it is designed for — `editMessageText` cannot
// turn a text bubble into a photo, so the production handler also
// drops the chart.
vi.mock("../../lib/chart.js", () => ({
  buildTrackChartPng: vi.fn().mockResolvedValue(null),
}));

import { makeBotHarness, type BotTestHarness } from "../helpers/bot.js";
import { WalletManager } from "../../lib/wallet.js";

const ZERO_MASTER_KEY = btoa("\0".repeat(32));
const RPC_URL = "https://rpc.test.local";
const API_BASE = "https://api.test.local";
const TOKEN = "0xaaaa000000000000000000000000000000000000";

const seedActiveWallet = async (h: BotTestHarness): Promise<string> => {
  const wm = new WalletManager(h.kv as unknown as KVNamespace, ZERO_MASTER_KEY);
  const w = await wm.createWallet(7);
  return w.address;
};

const ptCallback = (
  data: string,
  chatType: "private" | "group" = "private",
) => ({
  update_id: 10,
  callback_query: {
    id: "cbq-pt",
    from: { id: 7, is_bot: false, first_name: "Ada" },
    chat_instance: "instance-1",
    data,
    message: {
      message_id: 99,
      date: 0,
      chat: { id: 42, type: chatType },
    },
  },
});

interface TgCall {
  url: string;
  body: Record<string, unknown>;
}

const collect = (fetchSpy: ReturnType<typeof vi.spyOn>): TgCall[] =>
  (fetchSpy.mock.calls as Array<[unknown, unknown?]>)
    .filter((call) => typeof (call[1] as RequestInit | undefined)?.body === "string")
    .map((call) => ({
      url: String(call[0]),
      body: JSON.parse((call[1] as RequestInit).body as string) as Record<
        string,
        unknown
      >,
    }));

const TOKEN_FIXTURE = {
  address: TOKEN,
  name: "Alpha Token",
  ticker: "ALPHA",
  priceUsd: 0.001,
  mcapUsd: 5000,
  change24h: 0,
  ltChange24h: null,
  volume24hUsd: 0,
  curveFilled: 10,
  status: "curve",
  ltPair: null,
};

const mockApi = (
  fetchSpy: ReturnType<typeof vi.spyOn>,
  opts: { tokenFound?: boolean; tokenApiDown?: boolean } = {},
): void => {
  fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === RPC_URL) {
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0" }),
        { status: 200 },
      );
    }
    if (url.startsWith(API_BASE) && url.includes(`/api/v1/tokens/${TOKEN}`)) {
      if (opts.tokenApiDown) return new Response("", { status: 503 });
      if (opts.tokenFound === false) {
        return new Response(JSON.stringify({ error: "not found" }), {
          status: 404,
        });
      }
      return new Response(JSON.stringify({ data: TOKEN_FIXTURE }), {
        status: 200,
      });
    }
    if (url.startsWith(API_BASE) && url.includes("/api/v1/trades/")) {
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }
    if (url.startsWith(API_BASE) && url.includes("/api/v1/chart/")) {
      return new Response(
        JSON.stringify({
          data: { candles: [], currentRatio: 1, currentExchangeRate: 1 },
        }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({ ok: true, result: true }), {
      status: 200,
    });
  });
};

const harnessWithRpc = (): BotTestHarness => {
  const h = makeBotHarness();
  h.env.HYPEREVM_RPC_URL = RPC_URL;
  return h;
};

/**
 * Per-position `[📊 <TICKER>]` callback (`pt:<token>`). Replaces the
 * legacy `<a href="t.me/<bot>?start=track_<addr>">TICKER</a>` body
 * anchor — that anchor bounced the user through Telegram's `/start
 * track_<addr>` deeplink handler, dropping the user out of the
 * /positions bubble and posting a fresh /track card below. The callback
 * keeps everything inside one chat bubble: "Fetching <TICKER> token
 * details…" lands first, then the bubble is rewritten to the /track
 * card.
 */
describe("positions track callback (pt)", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("edits the bubble to 'Fetching <TICKER> token details…' before the final /track render", async () => {
    const h = harnessWithRpc();
    await seedActiveWallet(h);
    mockApi(fetchSpy);
    await h.run(ptCallback(`pt:${TOKEN}`));
    const edits = collect(fetchSpy).filter((c) =>
      c.url.includes("/editMessageText"),
    );
    // Two edits: loading prompt → final track card. The loading edit
    // is what gives the user immediate feedback that their tap landed.
    expect(edits.length).toBeGreaterThanOrEqual(2);
    const loading = String(edits[0]!.body.text);
    expect(loading).toContain("Fetching");
    expect(loading).toContain("ALPHA");
    expect(loading).toContain("token details");
    // Loading prompt carries the Back/Home nav row so the user can
    // bail without waiting for the trades/chart fetch to finish.
    const loadingMarkup = edits[0]!.body.reply_markup as {
      inline_keyboard: { text: string }[][];
    };
    const loadingLabels = loadingMarkup.inline_keyboard.flat().map((b) => b.text);
    expect(loadingLabels).toContain("← Back");
    expect(loadingLabels).toContain("🏠 Home");
  });

  it("rewrites the bubble to the /track text card on the final edit", async () => {
    const h = harnessWithRpc();
    await seedActiveWallet(h);
    mockApi(fetchSpy);
    await h.run(ptCallback(`pt:${TOKEN}`));
    const edits = collect(fetchSpy).filter((c) =>
      c.url.includes("/editMessageText"),
    );
    const last = edits.at(-1)!;
    const text = String(last.body.text);
    expect(text).toContain("Alpha Token");
    expect(text).toContain("ALPHA");
    expect(text).toContain("Recent trades");
    const markup = last.body.reply_markup as {
      inline_keyboard: { text: string; url?: string }[][];
    };
    // /track keyboard surface: Buy / Sell pair + Open on Alt Fun link +
    // Back/Home nav row. Verifies positions.ts wired up the same
    // keyboard the /track command itself emits.
    const labels = markup.inline_keyboard.flat().map((b) => b.text);
    expect(labels.some((t) => t.startsWith("Buy"))).toBe(true);
    expect(labels.some((t) => t.startsWith("Sell"))).toBe(true);
    expect(labels).toContain("Open on Alt Fun");
    expect(labels).toContain("← Back");
    expect(labels).toContain("🏠 Home");
  });

  it("never posts a fresh reply — every render stays in the same bubble", async () => {
    const h = harnessWithRpc();
    await seedActiveWallet(h);
    mockApi(fetchSpy);
    await h.run(ptCallback(`pt:${TOKEN}`));
    const sends = collect(fetchSpy).filter((c) =>
      c.url.includes("/sendMessage"),
    );
    // Regression for the original bug: tapping the ticker used to
    // bounce through `/start track_<addr>` which posted a brand-new
    // /track reply below the /positions card. The callback path must
    // edit only.
    expect(sends).toHaveLength(0);
  });

  it("toasts an outage when the token fetch fails and leaves the /positions bubble intact", async () => {
    const h = harnessWithRpc();
    await seedActiveWallet(h);
    mockApi(fetchSpy, { tokenApiDown: true });
    await h.run(ptCallback(`pt:${TOKEN}`));
    const edits = collect(fetchSpy).filter((c) =>
      c.url.includes("/editMessageText"),
    );
    const acks = collect(fetchSpy).filter((c) =>
      c.url.includes("/answerCallbackQuery"),
    );
    expect(edits).toHaveLength(0);
    expect(acks).toHaveLength(1);
    expect(String(acks[0]!.body.text).toLowerCase()).toContain(
      "data temporarily unavailable",
    );
  });

  it("toasts not-found and leaves the /positions bubble intact when the token doesn't exist", async () => {
    const h = harnessWithRpc();
    await seedActiveWallet(h);
    mockApi(fetchSpy, { tokenFound: false });
    await h.run(ptCallback(`pt:${TOKEN}`));
    const edits = collect(fetchSpy).filter((c) =>
      c.url.includes("/editMessageText"),
    );
    const acks = collect(fetchSpy).filter((c) =>
      c.url.includes("/answerCallbackQuery"),
    );
    expect(edits).toHaveLength(0);
    expect(acks).toHaveLength(1);
    expect(String(acks[0]!.body.text).toLowerCase()).toContain("not found");
  });

  it("rejects an invalid token address with a toast", async () => {
    const h = harnessWithRpc();
    await seedActiveWallet(h);
    mockApi(fetchSpy);
    await h.run(ptCallback("pt:not-a-token"));
    const acks = collect(fetchSpy).filter((c) =>
      c.url.includes("/answerCallbackQuery"),
    );
    expect(acks).toHaveLength(1);
    expect(String(acks[0]!.body.text)).toContain("Invalid token");
  });

  it("acks the callback so the client spinner unwinds", async () => {
    const h = harnessWithRpc();
    await seedActiveWallet(h);
    mockApi(fetchSpy);
    await h.run(ptCallback(`pt:${TOKEN}`));
    const acks = collect(fetchSpy).filter((c) =>
      c.url.includes("/answerCallbackQuery"),
    );
    expect(acks).toHaveLength(1);
  });
});
