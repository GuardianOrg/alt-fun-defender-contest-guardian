import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  makeBotHarness,
  mockTelegramOk,
  type BotTestHarness,
} from "./helpers/bot.js";
import { START_CALLBACK } from "../keyboards/start-menu.js";
import { WalletManager } from "../lib/wallet.js";

const USER_ID = 91;
const CHAT_ID = 91;

const commandUpdate = (cmd: string, updateId: number, chatType:
  | "private"
  | "group" = "private",
  chatId: number = CHAT_ID,
) => ({
  update_id: updateId,
  message: {
    message_id: 100 + updateId,
    date: 0,
    chat:
      chatType === "private"
        ? { id: chatId, type: "private" as const }
        : { id: chatId, type: "group" as const, title: "g" },
    from: { id: USER_ID, is_bot: false, first_name: "Mei" },
    text: cmd,
    entities: [{ type: "bot_command", offset: 0, length: cmd.length }],
  },
});

const callbackUpdate = (data: string, updateId: number) => ({
  update_id: updateId,
  callback_query: {
    id: `cbq-${updateId}`,
    from: { id: USER_ID, is_bot: false, first_name: "Mei" },
    chat_instance: "i-1",
    message: {
      message_id: 200,
      date: 0,
      chat: { id: CHAT_ID, type: "private" as const },
    },
    data,
  },
});

interface TgCall {
  url: string;
  body: Record<string, unknown>;
}

const captureTg = (fetchSpy: ReturnType<typeof vi.spyOn>): TgCall[] =>
  (fetchSpy.mock.calls as Array<[unknown, unknown?]>)
    .filter((c) => String(c[0]).startsWith("https://api.telegram.org"))
    .map((call) => ({
      url: String(call[0]),
      body: JSON.parse((call[1] as RequestInit).body as string) as Record<
        string,
        unknown
      >,
    }));

/**
 * Seed a grammY session for `USER_ID` with `language = SimplifiedChinese`.
 * The session middleware reads this on the next update and `getCtxLanguage`
 * resolves it for every callsite that has been threaded through `t()`.
 */
const seedChineseSession = async (h: BotTestHarness): Promise<void> => {
  await h.kv.put(
    `session:${USER_ID}`,
    JSON.stringify({
      slippageBps: 1000,
      defaultBuyUsdc: 20,
      buyPresetsUsdc: [20, 40, 60, 80, 100],
      sellPresetsPct: [10, 25, 50, 75, 100],
      executionTipGwei: 500_000_000,
      degenMode: true,
      language: "SimplifiedChinese",
    }),
  );
};

describe("language preference propagates across flows", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
    mockTelegramOk(fetchSpy);
  });
  afterEach(() => fetchSpy.mockRestore());

  it("renders /wallet response in SimplifiedChinese when session.language=SimplifiedChinese", async () => {
    const h = makeBotHarness();
    await seedChineseSession(h);
    await h.run(commandUpdate("/wallet", 1));
    const sends = captureTg(fetchSpy).filter((c) =>
      c.url.includes("/sendMessage"),
    );
    expect(sends.length).toBeGreaterThan(0);
    const wallet = sends.find((c) =>
      String((c.body as { text?: string }).text ?? "").includes("尚未创建任何钱包"),
    );
    expect(wallet).toBeDefined();
  });

  it("renders /referral non-private-chat reply in SimplifiedChinese", async () => {
    const h = makeBotHarness();
    await h.kv.put(
      `session:${USER_ID}`,
      JSON.stringify({
        slippageBps: 1000,
        defaultBuyUsdc: 20,
        degenMode: true,
        language: "SimplifiedChinese",
      }),
    );
    // Send from a group chat so the private-only gate fires.
    await h.run(commandUpdate("/referral", 1, "group", -100));
    const reply = captureTg(fetchSpy).find((c) =>
      String((c.body as { text?: string }).text ?? "").includes("仅限私聊"),
    );
    expect(reply).toBeDefined();
  });

  it("answers Withdraw start-menu toast loading text in SimplifiedChinese", async () => {
    const h = makeBotHarness();
    await seedChineseSession(h);
    // Create a wallet so the wizard does not early-out on "no active wallet".
    const wm = new WalletManager(
      h.kv as unknown as KVNamespace,
      h.env.MASTER_KEY,
    );
    await wm.createWallet(USER_ID);
    await h.run(callbackUpdate(START_CALLBACK.withdraw, 1));
    const editCalls = captureTg(fetchSpy).filter((c) =>
      c.url.includes("/editMessageText"),
    );
    // First edit is the loading placeholder before the wizard reads
    // balances. Should be localised.
    const loadingEdit = editCalls.find((c) =>
      String((c.body as { text?: string }).text ?? "").includes("加载提币中"),
    );
    expect(loadingEdit).toBeDefined();
  });

  it("renders /positions usage in SimplifiedChinese when sent in a group", async () => {
    const h = makeBotHarness();
    await h.kv.put(
      `session:${USER_ID}`,
      JSON.stringify({
        slippageBps: 1000,
        defaultBuyUsdc: 20,
        degenMode: true,
        language: "SimplifiedChinese",
      }),
    );
    // /positions in a non-private chat with no arg falls back to the
    // usage hint, which is the simplest localised path to assert against.
    await h.run(commandUpdate("/positions", 1, "group", -100));
    const reply = captureTg(fetchSpy).find((c) =>
      String((c.body as { text?: string }).text ?? "").includes("用法"),
    );
    expect(reply).toBeDefined();
  });
});
