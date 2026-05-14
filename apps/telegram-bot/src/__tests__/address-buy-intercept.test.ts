import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeBotHarness, withTelegramOk, type BotTestHarness } from "./helpers/bot.js";
import { START_CALLBACK } from "../keyboards/start-menu.js";
import { WalletManager } from "../lib/wallet.js";

const ZERO_MASTER_KEY = btoa("\0".repeat(32));
const RPC_URL = "https://rpc.test.local";
const API_BASE = "https://api.test.local";

const TOKEN_ADDR = "0x1111111111111111111111111111111111111111";
const WALLET_ADDR = "0x2222222222222222222222222222222222222222";
const USER_ID = 7;
const CHAT_ID = 42;

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

const messageUpdate = (text: string, updateId = 2) => ({
  update_id: updateId,
  message: {
    message_id: 100 + updateId,
    date: 0,
    chat: { id: CHAT_ID, type: "private" as const },
    from: { id: USER_ID, is_bot: false, first_name: "Ada" },
    text,
    entities: [],
  },
});

const callbackUpdate = (data: string, updateId = 1) => ({
  update_id: updateId,
  callback_query: {
    id: `cbq-${updateId}`,
    from: { id: USER_ID, is_bot: false, first_name: "Ada" },
    chat_instance: "i-1",
    message: {
      message_id: 100,
      date: 0,
      chat: { id: CHAT_ID, type: "private" as const },
    },
    data,
  },
});

const tokenResponse = () =>
  new Response(
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

const wireMocks = (fetchSpy: ReturnType<typeof vi.spyOn>): void => {
  withTelegramOk(fetchSpy, async (input) => {
    const url = String(input);
    if (url === RPC_URL) {
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          // 100 USDC (6dp), padded to 32-byte word
          result: `0x${(100_000_000n).toString(16).padStart(64, "0")}`,
        }),
        { status: 200 },
      );
    }
    if (url.startsWith(API_BASE) && url.includes("/api/v1/tokens/")) {
      return tokenResponse();
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
};

const harnessWithWallet = async (): Promise<BotTestHarness> => {
  const h = makeBotHarness();
  h.env.HYPEREVM_RPC_URL = RPC_URL;
  const wm = new WalletManager(h.kv as unknown as KVNamespace, ZERO_MASTER_KEY);
  const w = await wm.createWallet(USER_ID);
  const stored = (await h.kv.get(`wallet:${USER_ID}:${w.id}`)) as string;
  const parsed = JSON.parse(stored) as { address: string };
  parsed.address = WALLET_ADDR;
  await h.kv.put(`wallet:${USER_ID}:${w.id}`, JSON.stringify(parsed));
  await h.kv.put(
    `session:${USER_ID}`,
    JSON.stringify({
      slippageBps: 100,
      defaultBuyUsdc: 20,
      degenMode: false,
    }),
  );
  return h;
};

const findCardSend = (calls: TgCall[]): TgCall | undefined =>
  calls.find(
    (c) =>
      c.url.includes("/sendMessage") &&
      typeof c.body.text === "string" &&
      String(c.body.text).includes("Test Token"),
  );

describe("Address → buy menu intercept (issue #821)", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("pasting a bare contract address outside any flow lands the user on the buy card", async () => {
    const h = await harnessWithWallet();
    wireMocks(fetchSpy);

    await h.run(messageUpdate(TOKEN_ADDR, 5));

    const calls = capture(fetchSpy);
    const card = findCardSend(calls);
    expect(card).toBeDefined();
    const text = String(card!.body.text);
    expect(text).toContain("TEST");
    const keyboard =
      (card!.body.reply_markup as { inline_keyboard?: unknown[][] })
        ?.inline_keyboard ?? [];
    const buttons = keyboard.flat() as Array<{ text: string }>;
    expect(buttons.some((b) => b.text.includes("Buy 20"))).toBe(true);
    expect(buttons.some((b) => b.text.includes("Buy 100"))).toBe(true);
  });

  it("pasting an alt.fun URL outside any flow lands the buy card too", async () => {
    const h = await harnessWithWallet();
    wireMocks(fetchSpy);

    await h.run(messageUpdate(`https://alt.fun/${TOKEN_ADDR}`, 6));

    const card = findCardSend(capture(fetchSpy));
    expect(card).toBeDefined();
    expect(String(card!.body.text)).toContain("TEST");
  });

  it("pasting a hyperevmscan URL outside any flow lands the buy card too", async () => {
    const h = await harnessWithWallet();
    wireMocks(fetchSpy);

    await h.run(
      messageUpdate(`https://hyperevmscan.io/token/${TOKEN_ADDR}`, 11),
    );

    const card = findCardSend(capture(fetchSpy));
    expect(card).toBeDefined();
    expect(String(card!.body.text)).toContain("TEST");
  });

  it("group-chat address paste does NOT trigger the buy card (privacy: USDC balance must not leak into groups)", async () => {
    const h = await harnessWithWallet();
    wireMocks(fetchSpy);

    await h.run({
      update_id: 12,
      message: {
        message_id: 999,
        date: 0,
        chat: { id: -100, type: "group" as const, title: "Test Group" },
        from: { id: USER_ID, is_bot: false, first_name: "Ada" },
        text: TOKEN_ADDR,
        entities: [],
      },
    });

    const calls = capture(fetchSpy);
    const card = findCardSend(calls);
    expect(card).toBeUndefined();
    expect(
      calls.filter((c) => c.url.includes("/sendMessage")),
    ).toHaveLength(0);
  });

  it("non-address text outside any flow is ignored (no buy card, no error)", async () => {
    const h = await harnessWithWallet();
    wireMocks(fetchSpy);

    await h.run(messageUpdate("hello world", 7));

    const calls = capture(fetchSpy);
    expect(
      calls.filter((c) => c.url.includes("/sendMessage")),
    ).toHaveLength(0);
  });

  it("a pasted address inside the /withdraw wizard exits the wizard and shows the buy card", async () => {
    const h = await harnessWithWallet();
    wireMocks(fetchSpy);

    // Enter the wizard via the [Withdraw] button.
    await h.run(callbackUpdate(START_CALLBACK.withdraw, 1));
    fetchSpy.mockClear();
    wireMocks(fetchSpy);

    // Asset prompt is active. Paste the contract address.
    await h.run(messageUpdate(TOKEN_ADDR, 8));

    const calls = capture(fetchSpy);
    const card = findCardSend(calls);
    expect(card).toBeDefined();
    // The wizard's "Unsupported asset" retry copy must NOT fire.
    const unsupportedRetry = calls.find(
      (c) =>
        c.url.includes("/sendMessage") &&
        String(c.body.text).includes("Unsupported asset"),
    );
    expect(unsupportedRetry).toBeUndefined();
  });

  it("a pasted address inside the /settings buy-amount wizard exits and shows the buy card", async () => {
    const h = await harnessWithWallet();
    wireMocks(fetchSpy);

    // Open the buy-amount wizard via the settings button.
    await h.run(callbackUpdate("set:buy", 1));
    fetchSpy.mockClear();
    wireMocks(fetchSpy);

    await h.run(messageUpdate(TOKEN_ADDR, 9));

    const card = findCardSend(capture(fetchSpy));
    expect(card).toBeDefined();
    expect(String(card!.body.text)).toContain("TEST");
  });
});
