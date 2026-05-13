import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { encodeAbiParameters } from "viem";

import {
  makeBotHarness,
  withTelegramOk,
  type BotTestHarness,
} from "../helpers/bot.js";
import { START_CALLBACK } from "../../keyboards/start-menu.js";
import { WalletManager } from "../../lib/wallet.js";

const ROUTER_ADDR = "0x4444444444444444444444444444444444444444";

/** Encode a single uint256 as the `result` of an `eth_call` reply. */
const encodeUsdcOut = (raw: bigint): string =>
  encodeAbiParameters([{ type: "uint256" }], [raw]);

const ZERO_MASTER_KEY = btoa("\0".repeat(32));
const RPC_URL = "https://rpc.test.local";
const API_BASE = "https://api.test.local";

const TOKEN_ADDR = "0x1111111111111111111111111111111111111111";
const WALLET_ADDR = "0x2222222222222222222222222222222222222222";
const LT_ADDR = "0x3333333333333333333333333333333333333333";

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
    entities: [],
  },
});

interface TgCall {
  url: string;
  body: Record<string, unknown>;
}

/** Capture only fetch calls that carry a JSON body (Telegram API calls). */
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

const mockTokenAndRpc = (
  fetchSpy: ReturnType<typeof vi.spyOn>,
  opts: {
    tokenFound?: boolean;
    tokenBalance?: bigint;
    priceUsd?: number;
    apiDown?: boolean;
  } = {},
): void => {
  const price = opts.priceUsd ?? 0.001;
  const tokenResp =
    opts.tokenFound === false
      ? new Response(JSON.stringify({ error: "Token not found" }), {
          status: 404,
        })
      : new Response(
          JSON.stringify({
            data: {
              address: TOKEN_ADDR,
              name: "Test Token",
              ticker: "TEST",
              priceUsd: price,
              mcapUsd: 5000,
              change24h: -2.1,
              ltChange24h: 1.0,
              curveFilled: 30,
              status: "curve",
            },
          }),
          { status: 200 },
        );

  withTelegramOk(fetchSpy, async (input) => {
    const url = String(input);
    if (url === RPC_URL) {
      const bal = opts.tokenBalance ?? 100_000n * 10n ** 18n; // 100k tokens default
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: `0x${bal.toString(16).padStart(64, "0")}`,
        }),
        { status: 200 },
      );
    }
    if (url.startsWith(API_BASE) && url.includes("/api/v1/tokens/")) {
      if (opts.apiDown) {
        return new Response("", { status: 503 });
      }
      return tokenResp;
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
};

const walletManager = (h: BotTestHarness): WalletManager =>
  new WalletManager(h.kv as unknown as KVNamespace, ZERO_MASTER_KEY);

const harnessWithWallet = async (): Promise<BotTestHarness> => {
  const h = makeBotHarness();
  h.env.HYPEREVM_RPC_URL = RPC_URL;
  const wm = walletManager(h);
  const w = await wm.createWallet(7);
  const stored = (await h.kv.get(`wallet:7:${w.id}`)) as string;
  const parsed = JSON.parse(stored) as { address: string };
  parsed.address = WALLET_ADDR;
  await h.kv.put(`wallet:7:${w.id}`, JSON.stringify(parsed));
  // Seed degenMode: false so the default test path exercises the
  // confirm-card flow. Degen-on is asserted in its own dedicated test.
  await h.kv.put(
    "session:7",
    JSON.stringify({ slippageBps: 100, defaultBuyUsdc: 20, degenMode: false }),
  );
  return h;
};

describe("Sell flow (st:s button → conversation)", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("Sell button answers callback silently and sends token-address prompt", async () => {
    const h = makeBotHarness();
    mockTokenAndRpc(fetchSpy);
    await h.run(callbackUpdate(START_CALLBACK.sell));

    const calls = capture(fetchSpy);
    const answer = calls.find((c) => c.url.includes("/answerCallbackQuery"));
    const send = calls.find((c) => c.url.includes("/sendMessage"));

    expect(answer!.body.show_alert).toBeFalsy();
    expect(send).toBeDefined();
    expect(String(send!.body.text)).toMatch(/contract address|alt\.fun|hyperevmscan/i);
  });

  it("shows token card with token balance and sell buttons", async () => {
    const h = await harnessWithWallet();
    // 50k tokens × $0.001 = $50 holding
    mockTokenAndRpc(fetchSpy, {
      tokenBalance: 50_000n * 10n ** 18n,
      priceUsd: 0.001,
    });

    await h.run(callbackUpdate(START_CALLBACK.sell));
    fetchSpy.mockClear();
    mockTokenAndRpc(fetchSpy, {
      tokenBalance: 50_000n * 10n ** 18n,
      priceUsd: 0.001,
    });

    await h.run(messageUpdate(TOKEN_ADDR, 10));

    const calls = capture(fetchSpy);
    const send = calls.find((c) => c.url.includes("/sendMessage"));
    expect(send).toBeDefined();
    const text = String(send!.body.text);
    expect(text).toContain("Test Token");
    expect(text).toContain("TEST");
    // Must show token balance
    expect(text).toContain("Balance");

    const keyboard = (
      send!.body.reply_markup as { inline_keyboard?: unknown[][] }
    )?.inline_keyboard ?? [];
    const allBtns = keyboard.flat() as Array<{ text: string }>;
    expect(allBtns.some((b) => b.text.includes("Sell 20"))).toBe(true);
    expect(allBtns.some((b) => b.text.includes("Sell All"))).toBe(true);
    expect(allBtns.some((b) => b.text.includes("Sell X"))).toBe(true);
    expect(allBtns.some((b) => b.text.includes("Refresh"))).toBe(true);
  });

  it("Sell 20 callback rejects when holding is zero", async () => {
    const h = await harnessWithWallet();
    mockTokenAndRpc(fetchSpy, { tokenBalance: 0n });

    await h.run(callbackUpdate(`btsd:${TOKEN_ADDR}`));

    const calls = capture(fetchSpy);
    const answer = calls.find((c) => c.url.includes("/answerCallbackQuery"));
    expect(answer!.body.show_alert).toBe(true);
    expect(String(answer!.body.text)).toMatch(/no.*TEST|hold/i);
  });

  it("Sell 20 rejects when holding is below minimum proceeds threshold", async () => {
    const h = await harnessWithWallet();
    // 10 tokens × $0.001 = $0.01 — far below the $12 minimum sell
    mockTokenAndRpc(fetchSpy, {
      tokenBalance: 10n * 10n ** 18n,
      priceUsd: 0.001,
    });

    await h.run(callbackUpdate(`btsd:${TOKEN_ADDR}`));

    const calls = capture(fetchSpy);
    const answer = calls.find((c) => c.url.includes("/answerCallbackQuery"));
    expect(answer!.body.show_alert).toBe(true);
    expect(String(answer!.body.text)).toMatch(/minimum|proceeds/i);
  });

  it("Sell All shows confirmation when balance is sufficient", async () => {
    const h = await harnessWithWallet();
    // 100k tokens × $0.001 = $100 holding
    mockTokenAndRpc(fetchSpy, {
      tokenBalance: 100_000n * 10n ** 18n,
      priceUsd: 0.001,
    });

    await h.run(callbackUpdate(`btsa:${TOKEN_ADDR}`));

    const calls = capture(fetchSpy);
    const send = calls.find((c) => c.url.includes("/sendMessage"));
    expect(send).toBeDefined();
    expect(String(send!.body.text)).toContain("Ready to sell");
    expect(String(send!.body.text)).toContain("TEST");
  });

  it("Sell All rejects when holding is zero", async () => {
    const h = await harnessWithWallet();
    mockTokenAndRpc(fetchSpy, { tokenBalance: 0n });

    await h.run(callbackUpdate(`btsa:${TOKEN_ADDR}`));

    const calls = capture(fetchSpy);
    const answer = calls.find((c) => c.url.includes("/answerCallbackQuery"));
    expect(answer!.body.show_alert).toBe(true);
  });

  it("Sell Refresh edits the card in-place", async () => {
    const h = await harnessWithWallet();
    mockTokenAndRpc(fetchSpy, { tokenBalance: 100_000n * 10n ** 18n });

    await h.run(callbackUpdate(`btsr:${TOKEN_ADDR}`));

    const calls = capture(fetchSpy);
    const edit = calls.find((c) => c.url.includes("/editMessageText"));
    expect(edit).toBeDefined();
    const answer = calls.find((c) => c.url.includes("/answerCallbackQuery"));
    expect(String(answer!.body.text)).toBe("Refreshed");
  });

  it("shows error and re-prompts when token is not found", async () => {
    const h = await harnessWithWallet();
    mockTokenAndRpc(fetchSpy);

    await h.run(callbackUpdate(START_CALLBACK.sell));
    fetchSpy.mockClear();
    mockTokenAndRpc(fetchSpy, { tokenFound: false });

    await h.run(messageUpdate(TOKEN_ADDR, 10));

    const calls = capture(fetchSpy);
    const send = calls.find((c) => c.url.includes("/sendMessage"));
    expect(String(send!.body.text)).toMatch(/not found/i);
  });

  it("conversation aborts (not loops) when token API is unavailable", async () => {
    const h = await harnessWithWallet();
    mockTokenAndRpc(fetchSpy);

    await h.run(callbackUpdate(START_CALLBACK.sell));
    fetchSpy.mockClear();
    mockTokenAndRpc(fetchSpy, { apiDown: true });

    await h.run(messageUpdate(TOKEN_ADDR, 10));

    const calls = capture(fetchSpy);
    const sends = calls.filter((c) => c.url.includes("/sendMessage"));
    // Exactly one message: the abort reply. No re-prompt.
    expect(sends).toHaveLength(1);
    expect(String(sends[0]!.body.text)).toMatch(/unavailable|try again/i);
    expect(String(sends[0]!.body.text)).not.toMatch(/contract address|alt\.fun/i);
  });

  it("Sell All callback aborts when token balance RPC is unavailable (null)", async () => {
    const h = await harnessWithWallet();
    // Token API works but RPC throws → balance is null
    withTelegramOk(fetchSpy, async (input) => {
      const url = String(input);
      if (url === RPC_URL) throw new Error("RPC down");
      if (url.startsWith(API_BASE) && url.includes("/api/v1/tokens/")) {
        return new Response(
          JSON.stringify({
            data: {
              address: TOKEN_ADDR, name: "Test Token", ticker: "TEST",
              priceUsd: 0.001, mcapUsd: 5000, change24h: 0,
              ltChange24h: null, curveFilled: 30, status: "curve",
            },
          }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    await h.run(callbackUpdate(`btsa:${TOKEN_ADDR}`));

    const calls = capture(fetchSpy);
    const answer = calls.find((c) => c.url.includes("/answerCallbackQuery"));
    expect(answer!.body.show_alert).toBe(true);
    expect(String(answer!.body.text)).toMatch(/balance|unavailable|verify/i);
  });

  it("Sell All confirmation includes fee summary line", async () => {
    const h = await harnessWithWallet();
    mockTokenAndRpc(fetchSpy, {
      tokenBalance: 100_000n * 10n ** 18n,
      priceUsd: 0.001,
    });

    await h.run(callbackUpdate(`btsa:${TOKEN_ADDR}`));

    const calls = capture(fetchSpy);
    const send = calls.find((c) => c.url.includes("/sendMessage"));
    expect(send).toBeDefined();
    expect(String(send!.body.text)).toContain("Ready to sell");
    // Fee summary line is mandatory per AGENTS.md
    expect(String(send!.body.text)).toContain("Bot fee 0.5%");
    expect(String(send!.body.text)).toContain("Alt Fun fee 0.5%");
  });

  // Regression: btsr / btsd / btsa handlers used to .catch() unhandled
  // throws with a log-only sink, leaving the Telegram client spinner
  // stuck until its 30s timeout. The outer catch must ACK with
  // show_alert so the user sees the failure instead of a silent
  // button.
  it("btsr surfaces an outage toast when the handler throws (KV down)", async () => {
    const h = await harnessWithWallet();
    mockTokenAndRpc(fetchSpy, { tokenBalance: 100_000n * 10n ** 18n });
    const getActiveSpy = vi
      .spyOn(WalletManager.prototype, "getActive")
      .mockRejectedValue(new Error("kv down"));

    try {
      await h.run(callbackUpdate(`btsr:${TOKEN_ADDR}`));

      const calls = capture(fetchSpy);
      const answer = calls.find((c) => c.url.includes("/answerCallbackQuery"));
      expect(answer).toBeDefined();
      expect(answer!.body.show_alert).toBe(true);
      expect(String(answer!.body.text)).toMatch(/unavailable|try again/i);
    } finally {
      getActiveSpy.mockRestore();
    }
  });

  it("btsd surfaces an outage toast when the handler throws (KV down)", async () => {
    const h = await harnessWithWallet();
    mockTokenAndRpc(fetchSpy, { tokenBalance: 100_000n * 10n ** 18n });
    const getActiveSpy = vi
      .spyOn(WalletManager.prototype, "getActive")
      .mockRejectedValue(new Error("kv down"));

    try {
      await h.run(callbackUpdate(`btsd:${TOKEN_ADDR}`));

      const calls = capture(fetchSpy);
      const answer = calls.find((c) => c.url.includes("/answerCallbackQuery"));
      expect(answer).toBeDefined();
      expect(answer!.body.show_alert).toBe(true);
      expect(String(answer!.body.text)).toMatch(/unavailable|try again/i);
    } finally {
      getActiveSpy.mockRestore();
    }
  });

  it("btsa surfaces an outage toast when the handler throws (KV down)", async () => {
    const h = await harnessWithWallet();
    mockTokenAndRpc(fetchSpy, { tokenBalance: 100_000n * 10n ** 18n });
    const getActiveSpy = vi
      .spyOn(WalletManager.prototype, "getActive")
      .mockRejectedValue(new Error("kv down"));

    try {
      await h.run(callbackUpdate(`btsa:${TOKEN_ADDR}`));

      const calls = capture(fetchSpy);
      const answer = calls.find((c) => c.url.includes("/answerCallbackQuery"));
      expect(answer).toBeDefined();
      expect(answer!.body.show_alert).toBe(true);
      expect(String(answer!.body.text)).toMatch(/unavailable|try again/i);
    } finally {
      getActiveSpy.mockRestore();
    }
  });
});

/**
 * Sell-flow simulation path (issue #686). When `BOT_FEE_ROUTER_ADDRESS`
 * is configured, the min/target/insufficient checks must consult the
 * `BotFeeRouter.sellWithBotFee` simulation result instead of the
 * `priceUsd × balance × (1 − COMBINED_FEE_RATE)` heuristic. These tests
 * pin that contract with a `priceUsd` deliberately divergent from the
 * mocked `quotedUsdcOut` so the assertion can't accidentally hold via
 * the heuristic.
 */
describe("Sell flow (BotFeeRouter simulation)", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });

  const wireMocks = (
    tokenBalance: bigint,
    quotedUsdcOut: bigint,
    priceUsd: number,
  ): void => {
    withTelegramOk(fetchSpy, async (input, init) => {
      const url = String(input);
      if (url.startsWith(API_BASE) && url.includes("/api/v1/tokens/")) {
        return new Response(
          JSON.stringify({
            data: {
              address: TOKEN_ADDR,
              name: "Test Token",
              ticker: "TEST",
              priceUsd,
              mcapUsd: 5000,
              change24h: 0,
              ltChange24h: null,
              curveFilled: 30,
              status: "curve",
            },
          }),
          { status: 200 },
        );
      }
      // viem appends a trailing slash to the configured RPC URL when it
      // POSTs (the original `lib/rpc.ts` callers don't), so match on the
      // host prefix rather than exact equality.
      if (url.startsWith(RPC_URL)) {
        const body = JSON.parse(
          (init as RequestInit).body as string,
        ) as { params: [{ to: string; data: string }, string] };
        const to = body.params[0].to.toLowerCase();
        if (to === ROUTER_ADDR.toLowerCase()) {
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              result: encodeUsdcOut(quotedUsdcOut),
            }),
            { status: 200 },
          );
        }
        // Default RPC path = balanceOf(walletAddr) on the token contract.
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: `0x${tokenBalance.toString(16).padStart(64, "0")}`,
          }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
  };

  it("rejects Sell 20 when simulated proceeds < minimum, even if priceUsd × balance suggests otherwise", async () => {
    const h = await harnessWithWallet();
    h.env.BOT_FEE_ROUTER_ADDRESS = ROUTER_ADDR;
    // priceUsd × balance heuristic: 100k × $0.001 = $100 (would PASS the
    // $12 minimum). Simulation says the user only nets $5 (e.g. curve
    // is much thinner than the indexer's last reported price). The
    // simulation must win.
    wireMocks(100_000n * 10n ** 18n, 5_000_000n /* $5 */, 0.001);

    await h.run(callbackUpdate(`btsd:${TOKEN_ADDR}`));

    const calls = capture(fetchSpy);
    const answer = calls.find((c) => c.url.includes("/answerCallbackQuery"));
    expect(answer!.body.show_alert).toBe(true);
    expect(String(answer!.body.text)).toMatch(/minimum/i);
    // Must include the simulated $5, not the $99 heuristic value.
    expect(String(answer!.body.text)).toContain("5.00");
  });

  it("accepts Sell All when simulated proceeds clear the minimum", async () => {
    const h = await harnessWithWallet();
    h.env.BOT_FEE_ROUTER_ADDRESS = ROUTER_ADDR;
    // Heuristic would say $0.05 (below $12 min) — sim says $50, so the
    // sell must be allowed. This catches a regression where the
    // priceUsd path runs in addition to (rather than instead of) the
    // simulation.
    wireMocks(50_000n * 10n ** 18n, 50_000_000n /* $50 */, 0.000001);

    await h.run(callbackUpdate(`btsa:${TOKEN_ADDR}`));

    const calls = capture(fetchSpy);
    const send = calls.find((c) => c.url.includes("/sendMessage"));
    expect(send).toBeDefined();
    expect(String(send!.body.text)).toContain("Ready to sell");
  });

  it("rejects Sell 20 when simulated proceeds < target, surfacing the simulated value", async () => {
    const h = await harnessWithWallet();
    h.env.BOT_FEE_ROUTER_ADDRESS = ROUTER_ADDR;
    // Min ($12) clears, target ($20) doesn't.
    wireMocks(100_000n * 10n ** 18n, 15_000_000n /* $15 */, 1);

    await h.run(callbackUpdate(`btsd:${TOKEN_ADDR}`));

    const calls = capture(fetchSpy);
    const answer = calls.find((c) => c.url.includes("/answerCallbackQuery"));
    expect(answer!.body.show_alert).toBe(true);
    expect(String(answer!.body.text)).toMatch(/Insufficient|< \$20/i);
    expect(String(answer!.body.text)).toContain("15.00");
  });

  /**
   * Fail-closed regression (CodeRabbit feedback on #690). When the
   * router simulation is unavailable AND the indexer omits `priceUsd`,
   * neither validation path can confirm proceeds ≥ MIN_USDC_SELL_AMOUNT.
   * The handler must abort with a clear retry message rather than
   * silently letting the trade through.
   */
  it("aborts Sell 20 when simulation reverts AND priceUsd is null (fail-closed)", async () => {
    const h = await harnessWithWallet();
    h.env.BOT_FEE_ROUTER_ADDRESS = ROUTER_ADDR;
    withTelegramOk(fetchSpy, async (input, init) => {
      const url = String(input);
      if (url.startsWith(API_BASE) && url.includes("/api/v1/tokens/")) {
        return new Response(
          JSON.stringify({
            data: {
              address: TOKEN_ADDR,
              name: "Test Token",
              ticker: "TEST",
              priceUsd: null,
              mcapUsd: null,
              change24h: null,
              ltChange24h: null,
              curveFilled: 30,
              status: "curve",
            },
          }),
          { status: 200 },
        );
      }
      if (url.startsWith(RPC_URL)) {
        const body = JSON.parse(
          (init as RequestInit).body as string,
        ) as { params: [{ to: string }, string] };
        const to = body.params[0].to.toLowerCase();
        if (to === ROUTER_ADDR.toLowerCase()) {
          // Router reverts the simulation — no priceUsd to fall back on.
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              error: { code: 3, message: "execution reverted" },
            }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: `0x${(100_000n * 10n ** 18n).toString(16).padStart(64, "0")}`,
          }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    await h.run(callbackUpdate(`btsd:${TOKEN_ADDR}`));

    const calls = capture(fetchSpy);
    const answer = calls.find((c) => c.url.includes("/answerCallbackQuery"));
    const send = calls.find((c) => c.url.includes("/sendMessage"));
    expect(answer!.body.show_alert).toBe(true);
    expect(String(answer!.body.text)).toMatch(
      /Unable to estimate proceeds|try again/i,
    );
    // No "Ready to sell" confirmation must have been emitted.
    expect(send).toBeUndefined();
  });

  it("aborts Sell All when simulation reverts AND priceUsd is null (fail-closed)", async () => {
    const h = await harnessWithWallet();
    h.env.BOT_FEE_ROUTER_ADDRESS = ROUTER_ADDR;
    withTelegramOk(fetchSpy, async (input, init) => {
      const url = String(input);
      if (url.startsWith(API_BASE) && url.includes("/api/v1/tokens/")) {
        return new Response(
          JSON.stringify({
            data: {
              address: TOKEN_ADDR,
              name: "Test Token",
              ticker: "TEST",
              priceUsd: null,
              mcapUsd: null,
              change24h: null,
              ltChange24h: null,
              curveFilled: 30,
              status: "curve",
            },
          }),
          { status: 200 },
        );
      }
      if (url.startsWith(RPC_URL)) {
        const body = JSON.parse(
          (init as RequestInit).body as string,
        ) as { params: [{ to: string }, string] };
        const to = body.params[0].to.toLowerCase();
        if (to === ROUTER_ADDR.toLowerCase()) {
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              error: { code: 3, message: "execution reverted" },
            }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: `0x${(50_000n * 10n ** 18n).toString(16).padStart(64, "0")}`,
          }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    await h.run(callbackUpdate(`btsa:${TOKEN_ADDR}`));

    const calls = capture(fetchSpy);
    const answer = calls.find((c) => c.url.includes("/answerCallbackQuery"));
    const send = calls.find((c) => c.url.includes("/sendMessage"));
    expect(answer!.body.show_alert).toBe(true);
    expect(String(answer!.body.text)).toMatch(
      /Unable to estimate proceeds|try again/i,
    );
    expect(send).toBeUndefined();
  });
});

/**
 * LT buffer preflight (AGENTS.md `/sell` → "Buffer-limited sells").
 * Before tx construction the handler reads `baseAssetBalance()` on the
 * backing LT. When the buffer cannot cover the expected proceeds, the
 * sell must surface the cap and require an explicit confirm on the
 * reduced amount — never silently truncate, never let the user submit
 * a sell that will revert with `InsufficientBalance` on-chain.
 */
describe("Sell flow (LT buffer preflight)", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });

  /**
   * Wire the api + RPC mocks with three call shapes:
   *  - `/api/v1/tokens/:addr` → token row including `ltPair`
   *  - `eth_call` to `LT_ADDR` → `baseAssetBalance()` returning `bufferRaw`
   *  - any other `eth_call` → `tokenBalance` (covers `balanceOf` reads)
   */
  const wireMocks = (
    tokenBalance: bigint,
    bufferRaw: bigint,
    priceUsd: number,
  ): void => {
    withTelegramOk(fetchSpy, async (input, init) => {
      const url = String(input);
      if (url.startsWith(API_BASE) && url.includes("/api/v1/tokens/")) {
        return new Response(
          JSON.stringify({
            data: {
              address: TOKEN_ADDR,
              name: "Test Token",
              ticker: "TEST",
              priceUsd,
              mcapUsd: 5000,
              change24h: 0,
              ltChange24h: null,
              curveFilled: 30,
              status: "curve",
              ltPair: LT_ADDR,
            },
          }),
          { status: 200 },
        );
      }
      if (url.startsWith(RPC_URL)) {
        const body = JSON.parse(
          (init as RequestInit).body as string,
        ) as { params: [{ to: string; data: string }, string] };
        const to = body.params[0].to.toLowerCase();
        const data = body.params[0].data.toLowerCase();
        if (to === LT_ADDR.toLowerCase() && data.startsWith("0x1bc865d6")) {
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              result: `0x${bufferRaw.toString(16).padStart(64, "0")}`,
            }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: `0x${tokenBalance.toString(16).padStart(64, "0")}`,
          }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
  };

  it("Sell All caps the trade and requires explicit confirm when buffer < proceeds", async () => {
    const h = await harnessWithWallet();
    // 100k tokens × $0.001 = $100 expected proceeds. LT buffer holds
    // only $40 in USDC (raw 6dp) — well above the $12 minimum, so the
    // handler must reduce the sell and surface a confirm rather than
    // reject or silently truncate.
    wireMocks(100_000n * 10n ** 18n, 40_000_000n, 0.001);

    await h.run(callbackUpdate(`btsa:${TOKEN_ADDR}`));

    const calls = capture(fetchSpy);
    const send = calls.find((c) => c.url.includes("/sendMessage"));
    expect(send).toBeDefined();
    const text = String(send!.body.text);
    expect(text).toMatch(/Buffer low/i);
    // The cap is the buffer ($40) × BUFFER_CAP_SAFETY (0.99) = $39.60.
    expect(text).toContain("39.60");
    // Original proceeds preserved in the "reduced from" copy
    // ($100 holding × 0.99 combined-fee heuristic = $99 net).
    expect(text).toContain("99.00");
    // Still presents a Confirm button — the user must approve the
    // reduced amount explicitly.
    const keyboard = (
      send!.body.reply_markup as { inline_keyboard?: unknown[][] }
    )?.inline_keyboard ?? [];
    const btns = keyboard.flat() as Array<{ text: string }>;
    expect(btns.some((b) => b.text.includes("Confirm"))).toBe(true);
  });

  it("Sell 20 rejects with retry copy when buffer can't even support the minimum", async () => {
    const h = await harnessWithWallet();
    // Plenty of holding ($100) — but buffer is only $5, below the $12
    // minimum sell after the safety factor. Must reject outright with
    // the transient-replenish copy rather than stage a sub-minimum sell.
    wireMocks(100_000n * 10n ** 18n, 5_000_000n, 0.001);

    await h.run(callbackUpdate(`btsd:${TOKEN_ADDR}`));

    const calls = capture(fetchSpy);
    const answer = calls.find((c) => c.url.includes("/answerCallbackQuery"));
    expect(answer!.body.show_alert).toBe(true);
    expect(String(answer!.body.text)).toMatch(/buffer too low|replenish|retry/i);
    // No tx confirmation was staged.
    const send = calls.find((c) => c.url.includes("/sendMessage"));
    expect(send).toBeUndefined();
  });

  it("Sell All proceeds normally when buffer comfortably exceeds proceeds", async () => {
    const h = await harnessWithWallet();
    // $100 proceeds, $10k buffer — preflight is a no-op. Confirm message
    // must NOT mention buffer cap.
    wireMocks(100_000n * 10n ** 18n, 10_000_000_000n, 0.001);

    await h.run(callbackUpdate(`btsa:${TOKEN_ADDR}`));

    const calls = capture(fetchSpy);
    const send = calls.find((c) => c.url.includes("/sendMessage"));
    expect(send).toBeDefined();
    const text = String(send!.body.text);
    expect(text).toContain("Ready to sell");
    expect(text).not.toMatch(/Buffer low/i);
  });
});
