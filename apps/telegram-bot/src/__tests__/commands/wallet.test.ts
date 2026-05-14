import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  makeBotHarness,
  mockTelegramOk,
  type BotTestHarness,
} from "../helpers/bot.js";
import { WALLET_CALLBACK } from "../../keyboards/wallet-actions.js";
import { PinManager } from "../../lib/pin.js";
import {
  MAX_WALLETS_PER_USER,
  WalletManager,
} from "../../lib/wallet.js";

const ZERO_MASTER_KEY = btoa("\0".repeat(32));

const walletUpdate = (fromId: number | null) => ({
  update_id: 1,
  message: {
    message_id: 1,
    date: 0,
    chat: { id: 42, type: "private" as const },
    ...(fromId !== null
      ? { from: { id: fromId, is_bot: false, first_name: "Ada" } }
      : {}),
    text: "/wallet",
    entities: [{ type: "bot_command", offset: 0, length: 7 }],
  },
});

const callbackUpdate = (data: string) => ({
  update_id: 2,
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

const textUpdate = (text: string, updateId = 3) => ({
  update_id: updateId,
  message: {
    message_id: 200 + updateId,
    date: 0,
    chat: { id: 42, type: "private" as const },
    from: { id: 7, is_bot: false, first_name: "Ada" },
    text,
  },
});

interface TgCall {
  url: string;
  body: Record<string, unknown>;
}

const capture = (fetchSpy: ReturnType<typeof vi.spyOn>): TgCall[] =>
  (fetchSpy.mock.calls as Array<[unknown, unknown?]>).map((call) => ({
    url: String(call[0]),
    body: JSON.parse((call[1] as RequestInit).body as string) as Record<
      string,
      unknown
    >,
  }));

const walletManager = (h: BotTestHarness): WalletManager =>
  new WalletManager(h.kv as unknown as KVNamespace, ZERO_MASTER_KEY);

describe("/wallet command", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
    mockTelegramOk(fetchSpy);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  describe("main view", () => {
    it("renders 'No wallets yet' for a brand-new user, action keyboard limited to Create/Import", async () => {
      const h = makeBotHarness();
      await h.run(walletUpdate(7));
      const calls = capture(fetchSpy);
      const send = calls.find((c) => c.url.includes("/sendMessage"));
      expect(send).toBeDefined();
      expect(send!.body.text).toContain("No wallets yet");
      const keyboard = (
        send!.body.reply_markup as {
          inline_keyboard: { text: string }[][];
        }
      ).inline_keyboard;
      expect(keyboard.flat().map((b) => b.text)).toEqual([
        "Create",
        "Import",
        "← Back",
        "🏠 Home",
      ]);
    });

    it("lists existing wallets with the active marker and the full action set", async () => {
      const h = makeBotHarness();
      const wm = walletManager(h);
      const a = await wm.createWallet(7, "main");
      await wm.createWallet(7, "alt");

      await h.run(walletUpdate(7));
      const send = capture(fetchSpy).find((c) =>
        c.url.includes("/sendMessage"),
      );
      const text = send!.body.text as string;
      expect(text).toContain(`Wallets (2/${MAX_WALLETS_PER_USER})`);
      const lines = text.split("\n");
      expect(lines.find((l) => l.includes("main"))).toMatch(/^\*/);
      expect(lines.find((l) => l.includes("alt"))).toMatch(/^ /);
      expect(text).toContain(a.address.slice(0, 6));
      const buttons = (
        send!.body.reply_markup as {
          inline_keyboard: { text: string }[][];
        }
      ).inline_keyboard
        .flat()
        .map((b) => b.text);
      expect(buttons).toEqual([
        "Create",
        "Import",
        "Switch",
        "Rename",
        "Delete",
        "Export key",
        "Withdraw",
        "← Back",
        "🏠 Home",
      ]);
    });

    it("rejects /wallet when the message has no `from` (channel post / anon admin)", async () => {
      const h = makeBotHarness();
      await h.run(walletUpdate(null));
      const send = capture(fetchSpy).find((c) =>
        c.url.includes("/sendMessage"),
      );
      expect(send!.body.text).toContain(
        "Wallets require a personal Telegram account",
      );
    });
  });

  describe("Create button (wc)", () => {
    it("creates a wallet, edits the main view in place, toasts the address", async () => {
      const h = makeBotHarness();
      await h.run(callbackUpdate(WALLET_CALLBACK.create));
      const calls = capture(fetchSpy);
      const edit = calls.find((c) => c.url.includes("/editMessageText"));
      const answer = calls.find((c) =>
        c.url.includes("/answerCallbackQuery"),
      );
      expect(edit?.body.text).toContain(
        `Wallets (1/${MAX_WALLETS_PER_USER})`,
      );
      expect((answer?.body.text as string)).toMatch(/^Created 0x/);
      expect(await walletManager(h).listWallets(7)).toHaveLength(1);
    });

    it("toasts a cap-reached alert when at MAX_WALLETS_PER_USER, no new wallet persisted", async () => {
      const h = makeBotHarness();
      const wm = walletManager(h);
      for (let i = 0; i < MAX_WALLETS_PER_USER; i++) {
        await wm.createWallet(7, `w${i}`);
      }
      await h.run(callbackUpdate(WALLET_CALLBACK.create));
      const answer = capture(fetchSpy).find((c) =>
        c.url.includes("/answerCallbackQuery"),
      );
      expect(answer?.body.show_alert).toBe(true);
      expect(answer?.body.text).toContain("Wallet cap reached");
      expect(await wm.listWallets(7)).toHaveLength(MAX_WALLETS_PER_USER);
    });
  });

  describe("Switch flow (wsp -> ws:<id>)", () => {
    it("toasts 'no wallets' when picker invoked on an empty account", async () => {
      const h = makeBotHarness();
      await h.run(callbackUpdate(WALLET_CALLBACK.switchPicker));
      const answer = capture(fetchSpy).find((c) =>
        c.url.includes("/answerCallbackQuery"),
      );
      expect(answer?.body.text).toContain("No wallets to switch to");
    });

    it("renders a picker with one row per wallet plus a Back row", async () => {
      const h = makeBotHarness();
      const wm = walletManager(h);
      const a = await wm.createWallet(7, "main");
      const b = await wm.createWallet(7, "alt");
      await h.run(callbackUpdate(WALLET_CALLBACK.switchPicker));
      const edit = capture(fetchSpy).find((c) =>
        c.url.includes("/editMessageText"),
      );
      const keyboard = (
        edit!.body.reply_markup as {
          inline_keyboard: { text: string; callback_data: string }[][];
        }
      ).inline_keyboard;
      expect(keyboard).toHaveLength(3);
      expect(keyboard[0]?.[0]?.callback_data).toBe(
        `${WALLET_CALLBACK.switchTo}:${a.id}`,
      );
      expect(keyboard[1]?.[0]?.callback_data).toBe(
        `${WALLET_CALLBACK.switchTo}:${b.id}`,
      );
      expect(keyboard[2]?.[0]?.text).toBe("← Back");
      expect(keyboard[2]?.[1]?.text).toBe("🏠 Home");
      expect(keyboard[0]?.[0]?.text).toMatch(/^\* /);
      expect(keyboard[1]?.[0]?.text).toMatch(/^ {2}/);
    });

    it("ws:<id> updates active, edits back to main, toasts the new label", async () => {
      const h = makeBotHarness();
      const wm = walletManager(h);
      await wm.createWallet(7, "main");
      const alt = await wm.createWallet(7, "alt");
      await h.run(callbackUpdate(`${WALLET_CALLBACK.switchTo}:${alt.id}`));
      const calls = capture(fetchSpy);
      const answer = calls.find((c) =>
        c.url.includes("/answerCallbackQuery"),
      );
      const edit = calls.find((c) => c.url.includes("/editMessageText"));
      expect(answer?.body.text).toBe("Switched to alt");
      expect(edit?.body.text).toContain(
        `Wallets (2/${MAX_WALLETS_PER_USER})`,
      );
      expect((await wm.getActive(7))?.id).toBe(alt.id);
    });

    it("ws:<unknown> toasts 'no longer exists' and leaves active untouched", async () => {
      const h = makeBotHarness();
      const wm = walletManager(h);
      const a = await wm.createWallet(7, "main");
      await h.run(callbackUpdate(`${WALLET_CALLBACK.switchTo}:w_nope00`));
      const answer = capture(fetchSpy).find((c) =>
        c.url.includes("/answerCallbackQuery"),
      );
      expect(answer?.body.text).toContain("no longer exists");
      expect((await wm.getActive(7))?.id).toBe(a.id);
    });
  });

  describe("Stub buttons", () => {
    it("Rename without an active wallet toasts 'no active wallet' (not entering conversation)", async () => {
      const h = makeBotHarness();
      await h.run(callbackUpdate(WALLET_CALLBACK.rename));
      const answer = capture(fetchSpy).find((c) =>
        c.url.includes("/answerCallbackQuery"),
      );
      expect(answer?.body.show_alert).toBe(true);
      expect(answer?.body.text).toContain("No active wallet");
    });
  });

  // Each `h.run(...)` call rebuilds the Bot from scratch (see
  // makeBotHarness), mirroring the Workers per-request lifecycle. The
  // conversation state therefore has to round-trip through the shared
  // KV adapter — exactly the path that was silently dropped when the
  // conversations plugin was wired up with default in-memory storage.
  describe("Rename conversation (wr → text reply)", () => {
    it("persists the active conversation across worker invocations and renames the wallet on the follow-up text", async () => {
      const h = makeBotHarness();
      const wm = walletManager(h);
      await wm.createWallet(7, "old");

      await h.run(callbackUpdate(WALLET_CALLBACK.rename));
      const prompt = capture(fetchSpy).find(
        (c) =>
          c.url.includes("/sendMessage") &&
          String(c.body.text).includes("Send the new label"),
      );
      expect(prompt).toBeDefined();

      fetchSpy.mockClear();
      mockTelegramOk(fetchSpy);

      await h.run(textUpdate("renamed"));

      expect((await wm.listWallets(7))[0]?.label).toBe("renamed");
      const send = capture(fetchSpy).find((c) =>
        c.url.includes("/sendMessage"),
      );
      expect(send?.body.text).toContain("renamed");
    });

    it("rejects an empty label and leaves the wallet untouched", async () => {
      const h = makeBotHarness();
      const wm = walletManager(h);
      await wm.createWallet(7, "old");

      await h.run(callbackUpdate(WALLET_CALLBACK.rename));
      fetchSpy.mockClear();
      mockTelegramOk(fetchSpy);
      await h.run(textUpdate("   "));

      expect((await wm.listWallets(7))[0]?.label).toBe("old");
      const send = capture(fetchSpy).find((c) =>
        c.url.includes("/sendMessage"),
      );
      expect(String(send?.body.text)).toMatch(/Label must be/);
    });
  });

  describe("Export key flow (we)", () => {
    const buildPm = (h: BotTestHarness): PinManager =>
      new PinManager(h.kv as unknown as KVNamespace, { saltRounds: 4 });

    it("toasts 'no active wallet' when invoked on an empty account", async () => {
      const h = makeBotHarness();
      await h.run(callbackUpdate(WALLET_CALLBACK.exportKey));
      const answer = capture(fetchSpy).find((c) =>
        c.url.includes("/answerCallbackQuery"),
      );
      expect(answer?.body.show_alert).toBe(true);
      expect(answer?.body.text).toContain("No active wallet");
    });

    it("PIN set + correct verify reveals plaintext key with Delete-now button", async () => {
      const h = makeBotHarness();
      const wm = walletManager(h);
      const wallet = await wm.createWallet(7, "main");
      const pm = buildPm(h);
      await pm.setPin(7, "123456");

      // Enter conversation: callback triggers PIN prompt.
      fetchSpy.mockClear();
      mockTelegramOk(fetchSpy);
      await h.run(callbackUpdate(WALLET_CALLBACK.exportKey));
      const promptCalls = capture(fetchSpy);
      const prompt = promptCalls.find((c) =>
        c.url.includes("/sendMessage"),
      );
      expect(prompt?.body.text).toMatch(/Send your 6-digit PIN/);

      // Send correct PIN → bot decrypts and reveals.
      fetchSpy.mockClear();
      mockTelegramOk(fetchSpy);
      await h.run(textUpdate("123456", 3));
      const calls = capture(fetchSpy);
      // PIN message swept from chat history.
      const deletes = calls.filter((c) =>
        c.url.includes("/deleteMessage"),
      );
      expect(deletes.length).toBeGreaterThanOrEqual(1);
      // Reveal carries address + private key marker.
      const reveal = calls.find(
        (c) =>
          c.url.includes("/sendMessage") &&
          typeof c.body.text === "string" &&
          (c.body.text as string).includes("Private key:"),
      );
      expect(reveal).toBeDefined();
      expect(reveal!.body.text).toContain(wallet.address);
      const keyboard = (
        reveal!.body.reply_markup as {
          inline_keyboard: { text: string; callback_data: string }[][];
        }
      ).inline_keyboard;
      expect(keyboard[0]?.[0]?.callback_data).toBe(
        WALLET_CALLBACK.exportDelete,
      );
    });

    it("wrong PIN reports remaining attempts and does not reveal the key", async () => {
      const h = makeBotHarness();
      const wm = walletManager(h);
      await wm.createWallet(7, "main");
      const pm = buildPm(h);
      await pm.setPin(7, "123456");

      await h.run(callbackUpdate(WALLET_CALLBACK.exportKey));
      fetchSpy.mockClear();
      mockTelegramOk(fetchSpy);
      await h.run(textUpdate("000000", 3));

      const calls = capture(fetchSpy);
      const wrongReply = calls.find(
        (c) =>
          c.url.includes("/sendMessage") &&
          typeof c.body.text === "string" &&
          /Wrong PIN/.test(c.body.text as string),
      );
      expect(wrongReply).toBeDefined();
      expect(wrongReply!.body.text).toMatch(/4 attempts remaining/);
      const reveal = calls.find(
        (c) =>
          c.url.includes("/sendMessage") &&
          typeof c.body.text === "string" &&
          (c.body.text as string).includes("Private key:"),
      );
      expect(reveal).toBeUndefined();
    });

    it("PIN unset → set wizard prompts twice, then verify reveals the key", async () => {
      const h = makeBotHarness();
      const wm = walletManager(h);
      await wm.createWallet(7, "main");

      // Enter: bot prompts "No PIN set yet…"
      await h.run(callbackUpdate(WALLET_CALLBACK.exportKey));

      // Turn 1: send the new PIN. Bot asks for confirmation.
      fetchSpy.mockClear();
      mockTelegramOk(fetchSpy);
      await h.run(textUpdate("123456", 3));
      const afterFirst = capture(fetchSpy);
      const confirmPrompt = afterFirst.find(
        (c) =>
          c.url.includes("/sendMessage") &&
          /Confirm/.test(c.body.text as string),
      );
      expect(confirmPrompt).toBeDefined();

      // Turn 2: confirm. Bot asks to send once more to authorise.
      fetchSpy.mockClear();
      mockTelegramOk(fetchSpy);
      await h.run(textUpdate("123456", 4));
      const afterConfirm = capture(fetchSpy);
      expect(
        afterConfirm.find(
          (c) =>
            c.url.includes("/sendMessage") &&
            /authorise the export/.test(c.body.text as string),
        ),
      ).toBeDefined();

      // Turn 3: verify. Bot reveals the key.
      fetchSpy.mockClear();
      mockTelegramOk(fetchSpy);
      await h.run(textUpdate("123456", 5));
      const afterVerify = capture(fetchSpy);
      const reveal = afterVerify.find(
        (c) =>
          c.url.includes("/sendMessage") &&
          typeof c.body.text === "string" &&
          (c.body.text as string).includes("Private key:"),
      );
      expect(reveal).toBeDefined();

      // PIN persisted across the set + verify flow.
      const pm = buildPm(h);
      expect(await pm.isPinSet(7)).toBe(true);
    });

    it("a slash command typed at the PIN-set step halts the wizard without persisting a PIN", async () => {
      const h = makeBotHarness();
      const wm = walletManager(h);
      await wm.createWallet(7, "main");

      await h.run(callbackUpdate(WALLET_CALLBACK.exportKey));
      fetchSpy.mockClear();
      mockTelegramOk(fetchSpy);
      await h.run(textUpdate("/positions", 3));
      const pm = buildPm(h);
      expect(await pm.isPinSet(7)).toBe(false);
    });

    it("Delete-now button calls Telegram deleteMessage on the reveal (export)", async () => {
      const h = makeBotHarness();
      await h.run({
        update_id: 9001,
        callback_query: {
          id: "cbq-del",
          from: { id: 7, is_bot: false, first_name: "Ada" },
          chat_instance: "i-del",
          message: {
            message_id: 555,
            date: 0,
            chat: { id: 42, type: "private" as const },
          },
          data: WALLET_CALLBACK.exportDelete,
        },
      });
      const calls = capture(fetchSpy);
      const del = calls.find((c) => c.url.includes("/deleteMessage"));
      expect(del).toBeDefined();
      expect(del!.body.chat_id).toBe(42);
      expect(del!.body.message_id).toBe(555);
    });
  });

  // Import flow: callback → conversation prompts for private key →
  // user replies with the key → bot validates, persists, replies with
  // truncated address. The harness mirrors the per-request Workers
  // lifecycle, so the conversation state has to round-trip through KV
  // exactly like the Rename flow above.
  describe("Import flow (wi)", () => {
    const IMPORT_KEY =
      "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef" as const;

    it("prompts the user for the private key on callback entry", async () => {
      const h = makeBotHarness();
      await h.run(callbackUpdate(WALLET_CALLBACK.import));
      const prompt = capture(fetchSpy).find(
        (c) =>
          c.url.includes("/sendMessage") &&
          /Paste the private key/.test(c.body.text as string),
      );
      expect(prompt).toBeDefined();
      expect(await walletManager(h).listWallets(7)).toHaveLength(0);
      // Prompt copy says "Tap Home to exit" — the nav row must be on the
      // prompt message itself, not just on the parent menu.
      const kb =
        (prompt!.body.reply_markup as
          | {
              inline_keyboard?: Array<
                Array<{ text: string; callback_data?: string }>
              >;
            }
          | undefined)?.inline_keyboard ?? [];
      expect(
        kb.some(
          (row) =>
            row.some((b) => b.callback_data === "nav:h") &&
            row.some((b) => b.callback_data === "nav:b"),
        ),
      ).toBe(true);
    });

    it("persists the wallet on a valid key, sweeps the user message, and toasts the truncated address", async () => {
      const h = makeBotHarness();
      await h.run(callbackUpdate(WALLET_CALLBACK.import));
      fetchSpy.mockClear();
      mockTelegramOk(fetchSpy);

      await h.run(textUpdate(IMPORT_KEY));
      const calls = capture(fetchSpy);
      const deletes = calls.filter((c) => c.url.includes("/deleteMessage"));
      expect(deletes.length).toBeGreaterThanOrEqual(1);

      const list = await walletManager(h).listWallets(7);
      expect(list).toHaveLength(1);
      const success = calls.find(
        (c) =>
          c.url.includes("/sendMessage") &&
          /Imported 0x/.test(c.body.text as string),
      );
      expect(success).toBeDefined();
      // Plaintext key must never echo back into chat.
      const echoed = calls.find(
        (c) =>
          c.url.includes("/sendMessage") &&
          typeof c.body.text === "string" &&
          (c.body.text as string).includes(IMPORT_KEY),
      );
      expect(echoed).toBeUndefined();
    });

    it("rejects an invalid key and stays in the conversation for retry", async () => {
      const h = makeBotHarness();
      await h.run(callbackUpdate(WALLET_CALLBACK.import));
      fetchSpy.mockClear();
      mockTelegramOk(fetchSpy);

      await h.run(textUpdate("not-a-key"));
      const calls = capture(fetchSpy);
      const reject = calls.find(
        (c) =>
          c.url.includes("/sendMessage") &&
          /doesn't look like a private key/.test(c.body.text as string),
      );
      expect(reject).toBeDefined();
      expect(await walletManager(h).listWallets(7)).toHaveLength(0);

      // Conversation still active — a valid key on the next turn lands.
      fetchSpy.mockClear();
      mockTelegramOk(fetchSpy);
      await h.run(textUpdate(IMPORT_KEY, 4));
      expect(await walletManager(h).listWallets(7)).toHaveLength(1);
    });

    it("a slash command halts the import conversation without persisting", async () => {
      const h = makeBotHarness();
      await h.run(callbackUpdate(WALLET_CALLBACK.import));
      fetchSpy.mockClear();
      mockTelegramOk(fetchSpy);
      await h.run(textUpdate("/positions"));

      expect(await walletManager(h).listWallets(7)).toHaveLength(0);
    });

    it("rejects a duplicate key with a clear toast and does not double-list", async () => {
      const h = makeBotHarness();
      const wm = walletManager(h);
      await wm.importWallet(7, IMPORT_KEY, "first");

      await h.run(callbackUpdate(WALLET_CALLBACK.import));
      fetchSpy.mockClear();
      mockTelegramOk(fetchSpy);
      await h.run(textUpdate(IMPORT_KEY));

      const dup = capture(fetchSpy).find(
        (c) =>
          c.url.includes("/sendMessage") &&
          /already in your list/.test(c.body.text as string),
      );
      expect(dup).toBeDefined();
      expect((await wm.listWallets(7))).toHaveLength(1);
    });

    it("blocks entry with a cap-reached toast when at MAX_WALLETS_PER_USER", async () => {
      const h = makeBotHarness();
      const wm = walletManager(h);
      for (let i = 0; i < MAX_WALLETS_PER_USER; i++) {
        await wm.createWallet(7, `w${i}`);
      }
      await h.run(callbackUpdate(WALLET_CALLBACK.import));
      const answer = capture(fetchSpy).find((c) =>
        c.url.includes("/answerCallbackQuery"),
      );
      expect(answer?.body.show_alert).toBe(true);
      expect(answer?.body.text).toContain("Wallet cap reached");
      // No prompt was sent — entry was blocked.
      const prompt = capture(fetchSpy).find(
        (c) =>
          c.url.includes("/sendMessage") &&
          /Paste the private key/.test(c.body.text as string),
      );
      expect(prompt).toBeUndefined();
    });
  });

  describe("Delete wallet flow (wd)", () => {
    const buildPm = (h: BotTestHarness): PinManager =>
      new PinManager(h.kv as unknown as KVNamespace, { saltRounds: 4 });

    it("toasts 'no active wallet' when invoked on an empty account", async () => {
      const h = makeBotHarness();
      await h.run(callbackUpdate(WALLET_CALLBACK.delete));
      const answer = capture(fetchSpy).find((c) =>
        c.url.includes("/answerCallbackQuery"),
      );
      expect(answer?.body.show_alert).toBe(true);
      expect(answer?.body.text).toContain("No active wallet");
    });

    it("PIN verify + 'DELETE' confirm removes the wallet and refreshes the main view", async () => {
      const h = makeBotHarness();
      const wm = walletManager(h);
      await wm.createWallet(7, "main");
      const alt = await wm.createWallet(7, "alt");
      // Switch active to 'alt' so we can assert reassignment to wallets[0]
      // ('main') after delete.
      await wm.setActive(7, alt.id);
      const pm = buildPm(h);
      await pm.setPin(7, "123456");

      await h.run(callbackUpdate(WALLET_CALLBACK.delete));
      fetchSpy.mockClear();
      mockTelegramOk(fetchSpy);
      await h.run(textUpdate("123456", 3));
      const afterPin = capture(fetchSpy);
      const confirmPrompt = afterPin.find(
        (c) =>
          c.url.includes("/sendMessage") &&
          /Type DELETE to confirm/.test(c.body.text as string),
      );
      expect(confirmPrompt).toBeDefined();
      expect(confirmPrompt!.body.text).toContain(alt.address.slice(0, 6));

      fetchSpy.mockClear();
      mockTelegramOk(fetchSpy);
      await h.run(textUpdate("DELETE", 4));
      const afterConfirm = capture(fetchSpy);
      const success = afterConfirm.find(
        (c) =>
          c.url.includes("/sendMessage") &&
          /Deleted /.test(c.body.text as string),
      );
      expect(success).toBeDefined();

      const remaining = await wm.listWallets(7);
      expect(remaining).toHaveLength(1);
      expect(remaining[0]?.label).toBe("main");
      // Active reassigned to wallets[0] (the surviving wallet).
      expect((await wm.getActive(7))?.label).toBe("main");
    });

    it("anything other than DELETE at the confirm step aborts without deleting", async () => {
      const h = makeBotHarness();
      const wm = walletManager(h);
      await wm.createWallet(7, "keepme");
      const pm = buildPm(h);
      await pm.setPin(7, "123456");

      await h.run(callbackUpdate(WALLET_CALLBACK.delete));
      fetchSpy.mockClear();
      mockTelegramOk(fetchSpy);
      await h.run(textUpdate("123456", 3));

      fetchSpy.mockClear();
      mockTelegramOk(fetchSpy);
      await h.run(textUpdate("delete", 4));
      const calls = capture(fetchSpy);
      expect(
        calls.find(
          (c) =>
            c.url.includes("/sendMessage") &&
            /Delete cancelled/.test(c.body.text as string),
        ),
      ).toBeDefined();
      expect(await wm.listWallets(7)).toHaveLength(1);
    });

    it("wrong PIN reports remaining attempts and does not delete", async () => {
      const h = makeBotHarness();
      const wm = walletManager(h);
      await wm.createWallet(7, "main");
      const pm = buildPm(h);
      await pm.setPin(7, "123456");

      await h.run(callbackUpdate(WALLET_CALLBACK.delete));
      fetchSpy.mockClear();
      mockTelegramOk(fetchSpy);
      await h.run(textUpdate("000000", 3));

      const calls = capture(fetchSpy);
      const wrongReply = calls.find(
        (c) =>
          c.url.includes("/sendMessage") &&
          /Wrong PIN/.test(c.body.text as string),
      );
      expect(wrongReply).toBeDefined();
      expect(wrongReply!.body.text).toMatch(/4 attempts remaining/);
      expect(await wm.listWallets(7)).toHaveLength(1);
    });

    it("a slash command at the PIN step halts the delete wizard and leaves the wallet intact", async () => {
      const h = makeBotHarness();
      const wm = walletManager(h);
      await wm.createWallet(7, "main");
      const pm = buildPm(h);
      await pm.setPin(7, "123456");

      await h.run(callbackUpdate(WALLET_CALLBACK.delete));
      fetchSpy.mockClear();
      mockTelegramOk(fetchSpy);
      await h.run(textUpdate("/positions", 3));
      expect(await wm.listWallets(7)).toHaveLength(1);
    });

    it("PIN unset → set wizard runs with 'delete' copy, then confirms delete", async () => {
      const h = makeBotHarness();
      const wm = walletManager(h);
      await wm.createWallet(7, "main");

      await h.run(callbackUpdate(WALLET_CALLBACK.delete));

      // Turn 1: send new PIN. Bot asks for confirmation.
      fetchSpy.mockClear();
      mockTelegramOk(fetchSpy);
      await h.run(textUpdate("123456", 3));
      expect(
        capture(fetchSpy).find(
          (c) =>
            c.url.includes("/sendMessage") &&
            /Confirm/.test(c.body.text as string),
        ),
      ).toBeDefined();

      // Turn 2: confirm. Bot asks to authorise the delete.
      fetchSpy.mockClear();
      mockTelegramOk(fetchSpy);
      await h.run(textUpdate("123456", 4));
      expect(
        capture(fetchSpy).find(
          (c) =>
            c.url.includes("/sendMessage") &&
            /authorise the delete/.test(c.body.text as string),
        ),
      ).toBeDefined();

      // Turn 3: verify PIN. Bot asks for typed DELETE confirm.
      fetchSpy.mockClear();
      mockTelegramOk(fetchSpy);
      await h.run(textUpdate("123456", 5));
      expect(
        capture(fetchSpy).find(
          (c) =>
            c.url.includes("/sendMessage") &&
            /Type DELETE to confirm/.test(c.body.text as string),
        ),
      ).toBeDefined();

      // Turn 4: confirm.
      fetchSpy.mockClear();
      mockTelegramOk(fetchSpy);
      await h.run(textUpdate("DELETE", 6));
      expect(await wm.listWallets(7)).toHaveLength(0);
      expect(await buildPm(h).isPinSet(7)).toBe(true);
    });
  });
});
