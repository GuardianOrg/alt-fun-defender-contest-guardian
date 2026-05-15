import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  makeBotHarness,
  withTelegramOk,
  type BotTestHarness,
} from "../helpers/bot.js";
import { START_CALLBACK } from "../../keyboards/start-menu.js";
import * as trade from "../../lib/trade.js";
import { WalletManager } from "../../lib/wallet.js";

const ZERO_MASTER_KEY = btoa("\0".repeat(32));
const RPC_URL = "https://rpc.test.local";
const API_BASE = "https://api.test.local";

const TOKEN_ADDR = "0x1111111111111111111111111111111111111111";
const WALLET_ADDR = "0x2222222222222222222222222222222222222222";

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
    usdcBalance?: bigint;
    apiDown?: boolean;
  } = {},
): void => {
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
              priceUsd: 0.001,
              mcapUsd: 5000,
              change24h: 5.2,
              ltChange24h: 2.1,
              curveFilled: 30,
              status: "curve",
            },
          }),
          { status: 200 },
        );

  withTelegramOk(fetchSpy, async (input) => {
    const url = String(input);
    if (url === RPC_URL) {
      const bal = opts.usdcBalance ?? 100_000_000n; // $100 USDC by default
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
  // Patch address into the stored wallet so RPC calls are predictable
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

describe("Buy flow (st:b button → conversation)", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("Buy button answers callback silently and edits start menu into the token-address prompt", async () => {
    const h = makeBotHarness();
    mockTokenAndRpc(fetchSpy);
    await h.run(callbackUpdate(START_CALLBACK.buy));

    const calls = capture(fetchSpy);
    const answer = calls.find((c) => c.url.includes("/answerCallbackQuery"));
    // Start menu bubble is edited in place into the prompt — no fresh
    // sendMessage should fire for the prompt itself (regression for the
    // bug where the prompt was sent below the still-visible start menu).
    const send = calls.find((c) => c.url.includes("/sendMessage"));
    const edit = calls.find((c) => c.url.includes("/editMessageText"));

    expect(answer!.body.show_alert).toBeFalsy();
    expect(send).toBeUndefined();
    expect(edit).toBeDefined();
    expect(String(edit!.body.text)).toMatch(
      /contract address|alt\.fun|hyperevmscan/i,
    );
  });

  // Every prompt that instructs the user to "Tap Home to exit" must
  // carry the [← Back] [🏠 Home] inline row, or the user is told to tap
  // a button that isn't on the message they're reading.
  it("token-address prompt includes [← Back] [🏠 Home] nav buttons", async () => {
    const h = makeBotHarness();
    mockTokenAndRpc(fetchSpy);
    await h.run(callbackUpdate(START_CALLBACK.buy));

    const edit = capture(fetchSpy).find((c) =>
      c.url.includes("/editMessageText"),
    );
    expect(edit).toBeDefined();
    expect(String(edit!.body.text)).toMatch(/Tap Home to exit/);
    const kb =
      (edit!.body.reply_markup as
        | { inline_keyboard?: Array<Array<{ text: string; callback_data?: string }>> }
        | undefined)?.inline_keyboard ?? [];
    const navRow = kb.find((row) => row.some((b) => b.text === "🏠 Home"));
    expect(navRow).toBeDefined();
    expect(navRow!).toEqual([
      { text: "← Back", callback_data: "nav:b" },
      { text: "🏠 Home", callback_data: "nav:h" },
    ]);
  });

  it("re-renders the not-found retry in place (no new prompt below the bubble)", async () => {
    const h = await harnessWithWallet();
    mockTokenAndRpc(fetchSpy);

    // Enter the buy flow
    await h.run(callbackUpdate(START_CALLBACK.buy));
    fetchSpy.mockClear();
    mockTokenAndRpc(fetchSpy);

    // Send garbage input
    await h.run(messageUpdate("not an address at all", 10));

    const calls = capture(fetchSpy);
    const edit = calls.find((c) => c.url.includes("/editMessageText"));
    const send = calls.find((c) => c.url.includes("/sendMessage"));
    // Retry edits the same origin bubble that already shows the prompt;
    // no fresh reply lands below it.
    expect(edit).toBeDefined();
    expect(send).toBeUndefined();
    expect(String(edit!.body.text)).toMatch(/Token not found|contract address/i);
    // Token-not-found retry tells the user to "tap Home to exit", so it
    // must also carry the nav row.
    const kb =
      (edit!.body.reply_markup as
        | { inline_keyboard?: Array<Array<{ text: string; callback_data?: string }>> }
        | undefined)?.inline_keyboard ?? [];
    expect(
      kb.some((row) =>
        row.some((b) => b.text === "🏠 Home" && b.callback_data === "nav:h"),
      ),
    ).toBe(true);
  });

  it("accepts a valid address and edits the origin bubble in place to the buy token card", async () => {
    const h = await harnessWithWallet();
    mockTokenAndRpc(fetchSpy);

    await h.run(callbackUpdate(START_CALLBACK.buy));
    fetchSpy.mockClear();
    mockTokenAndRpc(fetchSpy);

    await h.run(messageUpdate(TOKEN_ADDR, 10));

    const calls = capture(fetchSpy);
    // The card replaces the prompt bubble in place — find the edit that
    // carries the card text. Any earlier edit on the same call list (e.g.
    // a benign retry edit) gets filtered out by matching on the ticker.
    const cardEdit = calls
      .filter((c) => c.url.includes("/editMessageText"))
      .find((c) => String(c.body.text).includes("Test Token"));
    expect(cardEdit).toBeDefined();
    const text = String(cardEdit!.body.text);
    expect(text).toContain("TEST");
    // Card must show USDC balance
    expect(text).toContain("USDC");
    // Buy keyboard must be present
    const keyboard = (cardEdit!.body.reply_markup as { inline_keyboard?: unknown[][] })
      ?.inline_keyboard ?? [];
    const allBtns = keyboard.flat() as Array<{ text: string }>;
    expect(allBtns.some((b) => b.text.includes("Buy 20"))).toBe(true);
    expect(allBtns.some((b) => b.text.includes("Buy 100"))).toBe(true);
    expect(allBtns.some((b) => b.text.includes("Buy X"))).toBe(true);
    expect(allBtns.some((b) => b.text.includes("Refresh"))).toBe(true);
  });

  it("accepts an alt.fun URL with embedded address and edits in place", async () => {
    const h = await harnessWithWallet();
    mockTokenAndRpc(fetchSpy);

    await h.run(callbackUpdate(START_CALLBACK.buy));
    fetchSpy.mockClear();
    mockTokenAndRpc(fetchSpy);

    await h.run(
      messageUpdate(`https://alt.fun/${TOKEN_ADDR}`, 10),
    );

    const calls = capture(fetchSpy);
    const cardEdit = calls
      .filter((c) => c.url.includes("/editMessageText"))
      .find((c) => String(c.body.text).includes("Test Token"));
    expect(cardEdit).toBeDefined();
  });

  // Regression for issue #805: a slash command typed mid-lookup used to
  // get parsed as a token address and surface "Token not found.". The
  // conversation must halt and let the outer middleware run the command
  // (here, /positions) so the user sees the actual /positions output.
  it("halts and forwards to the outer dispatcher when a slash command (e.g. /positions) is typed mid-lookup", async () => {
    const h = await harnessWithWallet();
    mockTokenAndRpc(fetchSpy);

    await h.run(callbackUpdate(START_CALLBACK.buy));
    fetchSpy.mockClear();
    withTelegramOk(fetchSpy, async (input) => {
      const url = String(input);
      if (url.includes("/api/v1/bot/positions/")) {
        return new Response(
          JSON.stringify({ data: { open: [], realised: [] } }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    await h.run({
      update_id: 10,
      message: {
        message_id: 10,
        date: 0,
        chat: { id: 42, type: "private" as const },
        from: { id: 7, is_bot: false, first_name: "Ada" },
        text: "/positions",
        entities: [{ type: "bot_command", offset: 0, length: 10 }],
      },
    });

    const calls = capture(fetchSpy);
    const sends = calls.filter((c) => c.url.includes("/sendMessage"));
    // The /positions handler runs and renders its empty-state copy
    // (issue #805 user-facing requirement). The "Token not found." path
    // from the buy-lookup conversation must not fire.
    expect(sends).toHaveLength(1);
    expect(String(sends[0]!.body.text)).toBe(
      "No open positions for this wallet.",
    );
    expect(String(sends[0]!.body.text)).not.toMatch(/Token not found/i);
    // The positions endpoint was hit — confirms the command actually ran
    // rather than the conversation silently swallowing the update.
    const positionsCall = (fetchSpy.mock.calls as Array<[unknown, unknown?]>)
      .map((c) => String(c[0]))
      .find((url) => url.includes("/api/v1/bot/positions/"));
    expect(positionsCall).toBeDefined();
  });

  it("conversation aborts (not loops) when token API is unavailable", async () => {
    const h = await harnessWithWallet();
    mockTokenAndRpc(fetchSpy);

    await h.run(callbackUpdate(START_CALLBACK.buy));
    fetchSpy.mockClear();
    mockTokenAndRpc(fetchSpy, { apiDown: true });

    await h.run(messageUpdate(TOKEN_ADDR, 10));

    const calls = capture(fetchSpy);
    const sends = calls.filter((c) => c.url.includes("/sendMessage"));
    // Exactly one message: the abort reply. No re-prompt asking for address again.
    expect(sends).toHaveLength(1);
    expect(String(sends[0]!.body.text)).toMatch(/unavailable|try again/i);
    // The abort message must NOT contain the token address prompt again
    expect(String(sends[0]!.body.text)).not.toMatch(/contract address|alt\.fun/i);
  });

  it("Buy 20 callback aborts with error when USDC balance RPC is unavailable (null)", async () => {
    const h = await harnessWithWallet();
    // Simulate RPC failure by making the mock throw for the RPC URL
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

    await h.run(callbackUpdate(`btp:${TOKEN_ADDR}:20`));

    const calls = capture(fetchSpy);
    const answer = calls.find((c) => c.url.includes("/answerCallbackQuery"));
    expect(answer!.body.show_alert).toBe(true);
    expect(String(answer!.body.text)).toMatch(/balance|unavailable|verify/i);
  });

  it("Buy 20 callback validates USDC balance is sufficient", async () => {
    const h = await harnessWithWallet();
    mockTokenAndRpc(fetchSpy, { usdcBalance: 100_000_000n }); // $100

    // btp:<addr>:<amount>
    const callbackData = `btp:${TOKEN_ADDR}:20`;
    await h.run(callbackUpdate(callbackData));

    const calls = capture(fetchSpy);
    const answer = calls.find((c) => c.url.includes("/answerCallbackQuery"));
    // Balance sufficient → no show_alert error
    expect(answer!.body.show_alert).toBeFalsy();
  });

  it("Buy 100 callback rejects when USDC balance is insufficient", async () => {
    const h = await harnessWithWallet();
    mockTokenAndRpc(fetchSpy, { usdcBalance: 10_000_000n }); // $10

    const callbackData = `btp:${TOKEN_ADDR}:100`;
    await h.run(callbackUpdate(callbackData));

    const calls = capture(fetchSpy);
    const answer = calls.find((c) => c.url.includes("/answerCallbackQuery"));
    expect(answer!.body.show_alert).toBe(true);
    expect(String(answer!.body.text)).toMatch(/insufficient|balance/i);
  });

  it("Buy 20 callback shows confirmation without fee summary in the menu", async () => {
    const h = await harnessWithWallet();
    mockTokenAndRpc(fetchSpy, { usdcBalance: 50_000_000n }); // $50

    await h.run(callbackUpdate(`btp:${TOKEN_ADDR}:20`));

    const calls = capture(fetchSpy);
    const send = calls.find((c) => c.url.includes("/sendMessage"));
    expect(send).toBeDefined();
    expect(String(send!.body.text)).toContain("Ready to buy");
    expect(String(send!.body.text)).toContain("20");
    // Fee summary moved to the tx-receipt endpoint per issue #801.
    expect(String(send!.body.text)).not.toContain("Bot fee 0.5%");
    expect(String(send!.body.text)).not.toContain("Alt Fun fee 0.75%");
  });

  it("buy confirmation shows token address and a ticker linking to the alt.fun tracking page", async () => {
    const h = await harnessWithWallet();
    mockTokenAndRpc(fetchSpy, { usdcBalance: 50_000_000n });

    await h.run(callbackUpdate(`btp:${TOKEN_ADDR}:20`));

    const calls = capture(fetchSpy);
    const send = calls.find((c) => c.url.includes("/sendMessage"));
    const text = String(send!.body.text);
    expect(text).toContain(`<code>${TOKEN_ADDR}</code>`);
    expect(text).toContain(
      `<a href="https://alt.fun/token/${TOKEN_ADDR}">TEST</a>`,
    );
  });

  it("Degen mode: Buy default skips the Confirm keyboard and submits immediately", async () => {
    const h = await harnessWithWallet();
    // Seed degen-mode = true on the user's session. The session adapter
    // hydrates this JSON on the next update.
    await h.kv.put(
      "session:7",
      JSON.stringify({
        slippageBps: 100,
        defaultBuyUsdc: 20,
        degenMode: true,
      }),
    );
    mockTokenAndRpc(fetchSpy, { usdcBalance: 50_000_000n }); // $50

    // Mock the chain-side call so we can assert it ran and so the test
    // never reaches actual RPC.
    const execSpy = vi.spyOn(trade, "executeBuy").mockResolvedValue({
      ok: true,
      txHash: "0xdeadbeef000000000000000000000000000000000000000000000000000000ab",
      quotedOut: 1n,
      minOut: 1n,
    });

    try {
      await h.run(callbackUpdate(`btp:${TOKEN_ADDR}:20`));

      const calls = capture(fetchSpy);
      const sends = calls.filter((c) => c.url.includes("/sendMessage"));

      // No "Ready to buy" + confirm-button card in degen mode.
      const confirmCard = sends.find((s) =>
        String(s.body.text).includes("Ready to buy"),
      );
      expect(confirmCard).toBeUndefined();

      // The reply chain renders the tx receipt instead. In degen mode
      // the receipt now lands by editing the buy card in-place through
      // the Tx-status phases, so look at both /sendMessage and
      // /editMessageText. Fee summary lives only in /help fees per
      // issue #801 — never on the buy menu and never on the receipt.
      const allTexts = calls
        .filter(
          (c) =>
            c.url.includes("/sendMessage") ||
            c.url.includes("/editMessageText"),
        )
        .map((c) => String(c.body.text));
      const receiptText = allTexts.find((t) => t.includes("Buy confirmed"));
      expect(receiptText).toBeDefined();
      expect(receiptText!).not.toContain("Bot fee 0.5%");
      expect(receiptText!).not.toContain("Alt Fun fee 0.75%");

      // No sendMessage carries a `cnf:` callback button.
      const hasConfirmButton = sends.some((s) => {
        const kb = (s.body.reply_markup as
          | { inline_keyboard?: Array<Array<{ callback_data?: string }>> }
          | undefined)?.inline_keyboard;
        return (
          kb?.flat().some((b) => (b.callback_data ?? "").startsWith("cnf:")) ??
          false
        );
      });
      expect(hasConfirmButton).toBe(false);

      // The chain-side path actually ran — degen mode is wired all the
      // way through executeBuy, not just a UI toggle.
      expect(execSpy).toHaveBeenCalledTimes(1);
    } finally {
      execSpy.mockRestore();
    }
  });

  it("btp callback buys the amount encoded in the payload (issue #818)", async () => {
    const h = await harnessWithWallet();
    // Pre-seed a non-default preset list — the keyboard would have
    // rendered slot 0 as $75, embedding `:75` in the btp callback.
    await h.kv.put(
      "session:7",
      JSON.stringify({
        slippageBps: 100,
        defaultBuyUsdc: 75,
        buyPresetsUsdc: [75, 40, 60, 80, 100],
        degenMode: false,
      }),
    );
    mockTokenAndRpc(fetchSpy, { usdcBalance: 500_000_000n }); // $500

    await h.run(callbackUpdate(`btp:${TOKEN_ADDR}:75`));

    const calls = capture(fetchSpy);
    const send = calls.find((c) => c.url.includes("/sendMessage"));
    expect(send).toBeDefined();
    const text = String(send!.body.text);
    expect(text).toContain("Ready to buy");
    expect(text).toContain("75");
    expect(text).not.toContain("$20");
  });

  it("Refresh callback re-fetches data and edits the card in-place", async () => {
    const h = await harnessWithWallet();
    mockTokenAndRpc(fetchSpy);

    await h.run(callbackUpdate(`btr:${TOKEN_ADDR}`));

    const calls = capture(fetchSpy);
    const edit = calls.find((c) => c.url.includes("/editMessageText"));
    const answer = calls.find((c) => c.url.includes("/answerCallbackQuery"));
    expect(edit).toBeDefined();
    expect(String(answer!.body.text)).toBe("Refreshed");
  });

  // Regression: btr / btp handlers used to .catch() unhandled throws
  // with a log-only sink, leaving the Telegram client spinner stuck
  // until its 30s timeout. The outer catch must ACK with show_alert
  // so the user sees the failure instead of a silent button.
  it("btr surfaces an outage toast when the handler throws (KV down)", async () => {
    const h = await harnessWithWallet();
    mockTokenAndRpc(fetchSpy);
    const getActiveSpy = vi
      .spyOn(WalletManager.prototype, "getActive")
      .mockRejectedValue(new Error("kv down"));

    try {
      await h.run(callbackUpdate(`btr:${TOKEN_ADDR}`));

      const calls = capture(fetchSpy);
      const answer = calls.find((c) => c.url.includes("/answerCallbackQuery"));
      expect(answer).toBeDefined();
      expect(answer!.body.show_alert).toBe(true);
      expect(String(answer!.body.text)).toMatch(/unavailable|try again/i);
    } finally {
      getActiveSpy.mockRestore();
    }
  });

  it("btp surfaces an outage toast when the handler throws (KV down)", async () => {
    const h = await harnessWithWallet();
    mockTokenAndRpc(fetchSpy);
    const getActiveSpy = vi
      .spyOn(WalletManager.prototype, "getActive")
      .mockRejectedValue(new Error("kv down"));

    try {
      await h.run(callbackUpdate(`btp:${TOKEN_ADDR}:20`));

      const calls = capture(fetchSpy);
      const answer = calls.find((c) => c.url.includes("/answerCallbackQuery"));
      expect(answer).toBeDefined();
      expect(answer!.body.show_alert).toBe(true);
      expect(String(answer!.body.text)).toMatch(/unavailable|try again/i);
    } finally {
      getActiveSpy.mockRestore();
    }
  });

  it("btp surfaces an outage toast for any preset amount (KV down)", async () => {
    const h = await harnessWithWallet();
    mockTokenAndRpc(fetchSpy);
    const getActiveSpy = vi
      .spyOn(WalletManager.prototype, "getActive")
      .mockRejectedValue(new Error("kv down"));

    try {
      await h.run(callbackUpdate(`btp:${TOKEN_ADDR}:100`));

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
