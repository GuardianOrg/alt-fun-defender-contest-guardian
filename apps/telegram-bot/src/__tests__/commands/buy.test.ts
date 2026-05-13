import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  makeBotHarness,
  withTelegramOk,
  type BotTestHarness,
} from "../helpers/bot.js";
import { START_CALLBACK } from "../../keyboards/start-menu.js";
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

  it("Buy button answers callback silently and sends token-address prompt", async () => {
    const h = makeBotHarness();
    mockTokenAndRpc(fetchSpy);
    await h.run(callbackUpdate(START_CALLBACK.buy));

    const calls = capture(fetchSpy);
    const answer = calls.find((c) => c.url.includes("/answerCallbackQuery"));
    const send = calls.find((c) => c.url.includes("/sendMessage"));

    expect(answer!.body.show_alert).toBeFalsy();
    expect(send).toBeDefined();
    expect(String(send!.body.text)).toMatch(/contract address|alt\.fun|hyperevmscan/i);
  });

  it("sends error message and re-prompts when input has no valid address", async () => {
    const h = await harnessWithWallet();
    mockTokenAndRpc(fetchSpy);

    // Enter the buy flow
    await h.run(callbackUpdate(START_CALLBACK.buy));
    fetchSpy.mockClear();
    mockTokenAndRpc(fetchSpy);

    // Send garbage input
    await h.run(messageUpdate("not an address at all", 10));

    const calls = capture(fetchSpy);
    const send = calls.find((c) => c.url.includes("/sendMessage"));
    expect(send).toBeDefined();
    expect(String(send!.body.text)).toMatch(/Token not found|contract address/i);
  });

  it("accepts a valid address and shows the buy token card", async () => {
    const h = await harnessWithWallet();
    mockTokenAndRpc(fetchSpy);

    await h.run(callbackUpdate(START_CALLBACK.buy));
    fetchSpy.mockClear();
    mockTokenAndRpc(fetchSpy);

    await h.run(messageUpdate(TOKEN_ADDR, 10));

    const calls = capture(fetchSpy);
    const send = calls.find((c) => c.url.includes("/sendMessage"));
    expect(send).toBeDefined();
    const text = String(send!.body.text);
    expect(text).toContain("Test Token");
    expect(text).toContain("TEST");
    // Card must show USDC balance
    expect(text).toContain("USDC");
    // Buy keyboard must be present
    const keyboard = (send!.body.reply_markup as { inline_keyboard?: unknown[][] })
      ?.inline_keyboard ?? [];
    const allBtns = keyboard.flat() as Array<{ text: string }>;
    expect(allBtns.some((b) => b.text.includes("Buy 20"))).toBe(true);
    expect(allBtns.some((b) => b.text.includes("Buy 100"))).toBe(true);
    expect(allBtns.some((b) => b.text.includes("Buy X"))).toBe(true);
    expect(allBtns.some((b) => b.text.includes("Refresh"))).toBe(true);
  });

  it("accepts an alt.fun URL with embedded address", async () => {
    const h = await harnessWithWallet();
    mockTokenAndRpc(fetchSpy);

    await h.run(callbackUpdate(START_CALLBACK.buy));
    fetchSpy.mockClear();
    mockTokenAndRpc(fetchSpy);

    await h.run(
      messageUpdate(`https://alt.fun/${TOKEN_ADDR}`, 10),
    );

    const calls = capture(fetchSpy);
    const send = calls.find((c) => c.url.includes("/sendMessage"));
    const text = String(send!.body.text);
    expect(text).toContain("Test Token");
  });

  it("shows API unavailable message and re-prompts when token API is down", async () => {
    const h = await harnessWithWallet();
    mockTokenAndRpc(fetchSpy);

    await h.run(callbackUpdate(START_CALLBACK.buy));
    fetchSpy.mockClear();
    mockTokenAndRpc(fetchSpy, { apiDown: true });

    await h.run(messageUpdate(TOKEN_ADDR, 10));

    const calls = capture(fetchSpy);
    const send = calls.find((c) => c.url.includes("/sendMessage"));
    expect(String(send!.body.text)).toMatch(/unavailable|try again/i);
  });

  it("Buy 20 callback validates USDC balance is sufficient", async () => {
    const h = await harnessWithWallet();
    mockTokenAndRpc(fetchSpy, { usdcBalance: 100_000_000n }); // $100

    // bt20:<addr>
    const callbackData = `bt20:${TOKEN_ADDR}`;
    await h.run(callbackUpdate(callbackData));

    const calls = capture(fetchSpy);
    const answer = calls.find((c) => c.url.includes("/answerCallbackQuery"));
    // Balance sufficient → no show_alert error
    expect(answer!.body.show_alert).toBeFalsy();
  });

  it("Buy 100 callback rejects when USDC balance is insufficient", async () => {
    const h = await harnessWithWallet();
    mockTokenAndRpc(fetchSpy, { usdcBalance: 10_000_000n }); // $10

    const callbackData = `bt100:${TOKEN_ADDR}`;
    await h.run(callbackUpdate(callbackData));

    const calls = capture(fetchSpy);
    const answer = calls.find((c) => c.url.includes("/answerCallbackQuery"));
    expect(answer!.body.show_alert).toBe(true);
    expect(String(answer!.body.text)).toMatch(/insufficient|balance/i);
  });

  it("Buy 20 callback shows confirmation when balance is sufficient", async () => {
    const h = await harnessWithWallet();
    mockTokenAndRpc(fetchSpy, { usdcBalance: 50_000_000n }); // $50

    await h.run(callbackUpdate(`bt20:${TOKEN_ADDR}`));

    const calls = capture(fetchSpy);
    const send = calls.find((c) => c.url.includes("/sendMessage"));
    expect(send).toBeDefined();
    expect(String(send!.body.text)).toContain("Ready to buy");
    expect(String(send!.body.text)).toContain("20");
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
});
