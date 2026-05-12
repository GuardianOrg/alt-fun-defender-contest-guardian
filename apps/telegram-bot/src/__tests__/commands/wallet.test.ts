import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import app from "../../index.js";
import { makeTestEnv } from "../helpers/env.js";
import { callbackHandlers } from "../../lib/callbacks.js";
// Import for side-effect: registers the wallet callback handlers.
import "../../commands/wallet.js";
import {
  MAX_WALLETS_PER_USER,
  WalletManager,
} from "../../lib/wallet.js";
import { WALLET_CALLBACK } from "../../keyboards/wallet-actions.js";

const ZERO_MASTER_KEY = btoa("\0".repeat(32));

/** In-memory KV that survives across helpers — same instance per test. */
class MemoryKV {
  private readonly store = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

// `fromId: null` means the message has no `from` (channel post / anon admin).
// Use null rather than an optional/defaulted param — JS default-param
// substitution would turn `walletUpdate(null)` back into the default.
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

const postWebhook = (body: unknown, env: ReturnType<typeof makeTestEnv>) =>
  app.request(
    "/webhook",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": "test-secret",
      },
      body: JSON.stringify(body),
    },
    env,
  );

interface CapturedCall {
  url: string;
  body: Record<string, unknown>;
}

const capture = (fetchSpy: ReturnType<typeof vi.spyOn>): CapturedCall[] =>
  fetchSpy.mock.calls.map((call: unknown[]) => {
    const [url, init] = call as [string | URL | Request, RequestInit];
    return {
      url: String(url),
      body: JSON.parse(init.body as string) as Record<string, unknown>,
    };
  });

describe("/wallet command", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let kv: MemoryKV;
  let env: ReturnType<typeof makeTestEnv>;

  beforeEach(() => {
    kv = new MemoryKV();
    env = makeTestEnv({
      MASTER_KEY: ZERO_MASTER_KEY,
      WALLET_KV: kv as unknown as KVNamespace,
    });
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  describe("main view", () => {
    it("renders 'No wallets yet' for a brand-new user with action keyboard", async () => {
      const res = await postWebhook(walletUpdate(7), env);
      expect(res.status).toBe(200);
      const calls = capture(fetchSpy);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.url).toBe(
        "https://api.telegram.org/bottest-bot-token/sendMessage",
      );
      expect(calls[0]?.body.text).toContain("No wallets yet");
      const keyboard = (
        calls[0]?.body.reply_markup as {
          inline_keyboard: { text: string; callback_data: string }[][];
        }
      ).inline_keyboard;
      // Create + Import always shown; Switch / Rename / Delete / Export
      // only when wallets exist so we never surface a button that errors.
      const allButtons = keyboard.flat().map((b) => b.text);
      expect(allButtons).toEqual(["Create", "Import"]);
    });

    it("lists existing wallets with the active marker and full action set", async () => {
      const wm = new WalletManager(kv as unknown as KVNamespace, ZERO_MASTER_KEY);
      const a = await wm.createWallet(7, "main");
      await wm.createWallet(7, "alt");

      await postWebhook(walletUpdate(7), env);
      const body = capture(fetchSpy)[0]?.body;
      const text = body?.text as string;
      expect(text).toContain(`Wallets (2/${MAX_WALLETS_PER_USER})`);
      // Active marker on the first wallet (it was created first).
      const lines = text.split("\n");
      const activeLine = lines.find((l) => l.includes("main"));
      expect(activeLine).toMatch(/^\*/);
      const altLine = lines.find((l) => l.includes("alt"));
      expect(altLine).toMatch(/^ /);
      // Truncated address present.
      expect(text).toContain(a.address.slice(0, 6));

      const keyboard = (
        body?.reply_markup as {
          inline_keyboard: { text: string }[][];
        }
      ).inline_keyboard;
      const allButtons = keyboard.flat().map((b) => b.text);
      expect(allButtons).toEqual([
        "Create",
        "Import",
        "Switch",
        "Rename",
        "Delete",
        "Export key",
        "Withdraw",
      ]);
    });

    it("rejects /wallet when the message has no `from` (channel post / anon admin)", async () => {
      await postWebhook(walletUpdate(null), env);
      const calls = capture(fetchSpy);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.body.text).toContain(
        "Wallets require a personal Telegram account",
      );
      expect(calls[0]?.body.reply_markup).toBeUndefined();
    });
  });

  describe("Create button (wc)", () => {
    it("creates a wallet, edits the message to the new state, and toasts the address", async () => {
      await postWebhook(callbackUpdate(WALLET_CALLBACK.create), env);
      const calls = capture(fetchSpy);
      // Expect: editMessageText (refreshed main view) + answerCallbackQuery (toast).
      const edit = calls.find((c) => c.url.endsWith("/editMessageText"));
      const answer = calls.find((c) =>
        c.url.endsWith("/answerCallbackQuery"),
      );
      expect(edit).toBeDefined();
      expect(answer).toBeDefined();
      expect(edit?.body.text).toContain(`Wallets (1/${MAX_WALLETS_PER_USER})`);
      expect((answer?.body.text as string)).toMatch(/^Created 0x/);

      // KV side-effects: index + record exist
      const wm = new WalletManager(kv as unknown as KVNamespace, ZERO_MASTER_KEY);
      expect(await wm.listWallets(7)).toHaveLength(1);
      expect(await wm.getActive(7)).not.toBeNull();
    });

    it("toasts a cap-reached alert when at MAX_WALLETS_PER_USER, no new wallet persisted", async () => {
      const wm = new WalletManager(kv as unknown as KVNamespace, ZERO_MASTER_KEY);
      for (let i = 0; i < MAX_WALLETS_PER_USER; i++) {
        await wm.createWallet(7, `w${i}`);
      }
      await postWebhook(callbackUpdate(WALLET_CALLBACK.create), env);
      const answer = capture(fetchSpy).find((c) =>
        c.url.endsWith("/answerCallbackQuery"),
      );
      expect(answer?.body.show_alert).toBe(true);
      expect(answer?.body.text).toContain("Wallet cap reached");
      expect(await wm.listWallets(7)).toHaveLength(MAX_WALLETS_PER_USER);
    });
  });

  describe("Switch flow (wsp -> ws:<id>)", () => {
    it("toasts 'no wallets' when picker invoked on an empty account", async () => {
      await postWebhook(
        callbackUpdate(WALLET_CALLBACK.switchPicker),
        env,
      );
      const answer = capture(fetchSpy).find((c) =>
        c.url.endsWith("/answerCallbackQuery"),
      );
      expect(answer?.body.text).toContain("No wallets to switch to");
    });

    it("renders a picker with one row per wallet plus a Back row", async () => {
      const wm = new WalletManager(kv as unknown as KVNamespace, ZERO_MASTER_KEY);
      const a = await wm.createWallet(7, "main");
      const b = await wm.createWallet(7, "alt");
      await postWebhook(
        callbackUpdate(WALLET_CALLBACK.switchPicker),
        env,
      );
      const edit = capture(fetchSpy).find((c) =>
        c.url.endsWith("/editMessageText"),
      );
      const keyboard = (
        edit?.body.reply_markup as {
          inline_keyboard: { text: string; callback_data: string }[][];
        }
      ).inline_keyboard;
      // Two wallet rows + Back row
      expect(keyboard).toHaveLength(3);
      expect(keyboard[0]?.[0]?.callback_data).toBe(`${WALLET_CALLBACK.switchTo}:${a.id}`);
      expect(keyboard[1]?.[0]?.callback_data).toBe(`${WALLET_CALLBACK.switchTo}:${b.id}`);
      expect(keyboard[2]?.[0]?.callback_data).toBe(WALLET_CALLBACK.mainBack);
      // Active marker on the first wallet (created first).
      expect(keyboard[0]?.[0]?.text).toMatch(/^\* /);
      expect(keyboard[1]?.[0]?.text).toMatch(/^ {2}/);
    });

    it("ws:<id> updates active, edits the message back to main, and toasts the new label", async () => {
      const wm = new WalletManager(kv as unknown as KVNamespace, ZERO_MASTER_KEY);
      await wm.createWallet(7, "main");
      const alt = await wm.createWallet(7, "alt");
      await postWebhook(
        callbackUpdate(`${WALLET_CALLBACK.switchTo}:${alt.id}`),
        env,
      );
      const calls = capture(fetchSpy);
      const answer = calls.find((c) =>
        c.url.endsWith("/answerCallbackQuery"),
      );
      const edit = calls.find((c) => c.url.endsWith("/editMessageText"));
      expect(answer?.body.text).toBe("Switched to alt");
      expect(edit?.body.text).toContain(`Wallets (2/${MAX_WALLETS_PER_USER})`);
      expect((await wm.getActive(7))?.id).toBe(alt.id);
    });

    it("ws:<unknown> toasts 'no longer exists' and leaves active untouched", async () => {
      const wm = new WalletManager(kv as unknown as KVNamespace, ZERO_MASTER_KEY);
      const a = await wm.createWallet(7, "main");
      await postWebhook(
        callbackUpdate(`${WALLET_CALLBACK.switchTo}:w_nope00`),
        env,
      );
      const answer = capture(fetchSpy).find((c) =>
        c.url.endsWith("/answerCallbackQuery"),
      );
      expect(answer?.body.text).toContain("no longer exists");
      expect((await wm.getActive(7))?.id).toBe(a.id);
    });
  });

  describe("Stub buttons", () => {
    it.each([
      [WALLET_CALLBACK.import, /multi-step wizard/],
      [WALLET_CALLBACK.rename, /multi-step wizard/],
      [WALLET_CALLBACK.delete, /PIN/],
      [WALLET_CALLBACK.exportKey, /PIN/],
      [WALLET_CALLBACK.withdraw, /PIN/],
    ])(
      "%s surfaces a 'coming soon' alert rather than silently no-op'ing",
      async (cmd, pattern) => {
        await postWebhook(callbackUpdate(cmd), env);
        const answer = capture(fetchSpy).find((c) =>
          c.url.endsWith("/answerCallbackQuery"),
        );
        expect(answer?.body.show_alert).toBe(true);
        expect(answer?.body.text).toMatch(pattern);
      },
    );
  });

  describe("Registry shape", () => {
    it("registers exactly the documented WALLET_CALLBACK codes", () => {
      for (const code of Object.values(WALLET_CALLBACK)) {
        expect(callbackHandlers.has(code)).toBe(true);
      }
    });
  });
});
