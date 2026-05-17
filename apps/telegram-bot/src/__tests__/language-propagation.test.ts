import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  makeBotHarness,
  mockTelegramOk,
  withTelegramOk,
  type BotTestHarness,
} from "./helpers/bot.js";
import { SETTINGS_CALLBACK } from "../keyboards/settings-actions.js";
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
    const body = String(
      (wallet!.body as { text?: string }).text ?? "",
    );
    // PIN status, withdrawal-lock status, and the empty-state Create /
    // Import hints all live on the empty /wallet panel — every one of
    // them must render in Simplified Chinese, not English.
    expect(body).toContain("PIN：未设置");
    expect(body).toContain("提币锁定：关闭");
    expect(body).toContain("新建 — 生成一个由机器人管理的新钱包");
    expect(body).toContain("导入 — 粘贴已有的私钥");
  });

  it("renders /wallet wallet-list view in SimplifiedChinese", async () => {
    const h = makeBotHarness();
    await seedChineseSession(h);
    const wm = new WalletManager(
      h.kv as unknown as KVNamespace,
      h.env.MASTER_KEY,
    );
    await wm.createWallet(USER_ID);
    await h.run(commandUpdate("/wallet", 1));
    const sends = captureTg(fetchSpy).filter((c) =>
      c.url.includes("/sendMessage"),
    );
    const body = String(
      (sends[0]!.body as { text?: string }).text ?? "",
    );
    // List header, "(unlabeled)" placeholder, and active-wallet legend
    // all need to land translated when a wallet exists.
    expect(body).toContain("钱包（1/");
    expect(body).toContain("（未命名）");
    expect(body).toContain("活动钱包");
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

  // Regression: tapping the start-menu Wallet button after the user
  // switched language must render the wallet panel keyboard in the new
  // language. `renderMainState` used to forget to pass `lang` into
  // `buildWalletMainKeyboard`, so the body text translated but every
  // button below it stayed English.
  it("Wallet start-menu button renders keyboard buttons in SimplifiedChinese", async () => {
    const h = makeBotHarness();
    await seedChineseSession(h);
    const wm = new WalletManager(
      h.kv as unknown as KVNamespace,
      h.env.MASTER_KEY,
    );
    await wm.createWallet(USER_ID);
    await h.run(callbackUpdate(START_CALLBACK.wallet, 1));
    const edits = captureTg(fetchSpy).filter((c) =>
      c.url.includes("/editMessageText"),
    );
    expect(edits.length).toBeGreaterThan(0);
    const keyboard = (
      edits[0]!.body.reply_markup as {
        inline_keyboard: { text: string }[][];
      }
    ).inline_keyboard;
    const labels = keyboard.flat().map((b) => b.text);
    // First row is Create / Import — both must be localised.
    expect(labels).toContain("新建");
    expect(labels).toContain("导入");
    // Trailing back/home row must also be localised.
    expect(labels).toContain("← 返回");
    expect(labels).toContain("🏠 主页");
  });

  // Regression: tapping the start-menu Positions button after a language
  // switch used to render an English back/home row because
  // `buildPositionsPageKeyboard` called `backHomeRow()` with no argument
  // and `renderView` swallowed the user's language entirely.
  it("Positions start-menu button renders keyboard in SimplifiedChinese", async () => {
    const h = makeBotHarness();
    await seedChineseSession(h);
    const wm = new WalletManager(
      h.kv as unknown as KVNamespace,
      h.env.MASTER_KEY,
    );
    await wm.createWallet(USER_ID);
    withTelegramOk(fetchSpy, async (input) => {
      const url = String(input);
      if (url.includes("/api/v1/bot/positions-v2/")) {
        return new Response(
          JSON.stringify({ data: { open: [], realised: [] } }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    await h.run(callbackUpdate(START_CALLBACK.positions, 1));
    const edits = captureTg(fetchSpy).filter((c) =>
      c.url.includes("/editMessageText"),
    );
    expect(edits.length).toBeGreaterThan(0);
    const keyboard = (
      edits[0]!.body.reply_markup as {
        inline_keyboard: { text: string }[][];
      }
    ).inline_keyboard;
    const labels = keyboard.flat().map((b) => b.text);
    expect(labels).toContain("🔄 刷新");
    expect(labels).toContain("← 返回");
    expect(labels).toContain("🏠 主页");
  });

  // Regression: changing language in the settings panel must clear the
  // nav stack so a subsequent Back tap does not restore the stale
  // English /start snapshot that was captured when the user entered
  // settings. With the stack empty, Back falls through to Home and
  // re-renders /start fresh in the new language. We assert the stack
  // is empty after the toggle — the downstream Back → renderHome path
  // is covered by `nav.test.ts` against the same empty-stack input.
  it("language-switch callback clears the navStack so a later Back falls through to a fresh Home render", async () => {
    const h = makeBotHarness();
    // Seed a session whose navStack carries the English /start
    // snapshot that would have been pushed when the user entered
    // settings. Default language stays English — the callback toggles
    // it to SimplifiedChinese.
    await h.kv.put(
      `session:${USER_ID}`,
      JSON.stringify({
        slippageBps: 1000,
        defaultBuyUsdc: 20,
        buyPresetsUsdc: [20, 40, 60, 80, 100],
        sellPresetsPct: [10, 25, 50, 75, 100],
        executionTipGwei: 500_000_000,
        degenMode: true,
        language: "English",
        navStack: [
          {
            text: "Welcome to Alt Fun.",
            keyboard: [
              [{ text: "Settings", callback_data: "st:set" }],
            ],
          },
        ],
      }),
    );
    await h.run(
      callbackUpdate(`${SETTINGS_CALLBACK.language}:SimplifiedChinese`, 1),
    );
    const raw = (await h.kv.get(`session:${USER_ID}`)) as string | null;
    expect(raw).not.toBeNull();
    const session = JSON.parse(raw!) as {
      language?: string;
      navStack?: unknown[];
    };
    expect(session.language).toBe("SimplifiedChinese");
    expect(session.navStack ?? []).toEqual([]);
  });
});
