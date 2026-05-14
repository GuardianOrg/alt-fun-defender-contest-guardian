import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  makeBotHarness,
  mockTelegramOk,
  withTelegramOk,
  type BotTestHarness,
} from "../helpers/bot.js";
import { START_CALLBACK } from "../../keyboards/start-menu.js";
import { PinManager } from "../../lib/pin.js";
import { SecurityState } from "../../lib/security-state.js";
import { WalletManager } from "../../lib/wallet.js";

const USER_ID = 7;
const CHAT_ID = 42;
const DEST = "0xabcdef0123456789abcdef0123456789abcdef01";

const callbackUpdate = (data: string, updateId = 2) => ({
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

const textUpdate = (text: string, updateId: number) => ({
  update_id: updateId,
  message: {
    message_id: 200 + updateId,
    date: 0,
    chat: { id: CHAT_ID, type: "private" as const },
    from: { id: USER_ID, is_bot: false, first_name: "Ada" },
    text,
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

const buildPm = (h: BotTestHarness): PinManager =>
  new PinManager(h.kv as unknown as KVNamespace, { saltRounds: 4 });

const buildSec = (h: BotTestHarness): SecurityState =>
  new SecurityState(h.kv as unknown as KVNamespace);

const ensureActiveWallet = async (h: BotTestHarness): Promise<void> => {
  const wm = new WalletManager(
    h.kv as unknown as KVNamespace,
    h.env.MASTER_KEY,
  );
  await wm.createWallet(USER_ID);
};

/** Walk the wizard up to (but not including) the PIN prompt. */
const enterAndAnswerWizard = async (
  h: BotTestHarness,
  fetchSpy: ReturnType<typeof vi.spyOn>,
): Promise<void> => {
  await h.run(callbackUpdate(START_CALLBACK.withdraw, 1));
  fetchSpy.mockClear();
  mockTelegramOk(fetchSpy);

  // Asset picker is now button-driven: the wizard renders [USDC] [HYPE]
  // on the prompt and awaits a callback_query rather than a text reply.
  await h.run(callbackUpdate("wda:hype", 2));
  fetchSpy.mockClear();
  mockTelegramOk(fetchSpy);

  await h.run(textUpdate("0.1", 3));
  fetchSpy.mockClear();
  mockTelegramOk(fetchSpy);

  await h.run(textUpdate(DEST, 4));
};

describe("/withdraw command", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
    mockTelegramOk(fetchSpy);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("amount prompt surfaces the wallet's available balance for the chosen asset", async () => {
    const h = makeBotHarness();
    await ensureActiveWallet(h);
    await buildPm(h).setPin(USER_ID, "123456");

    // 1.5 HYPE in wei = 1.5e18 = 0x14d1120d7b160000. Balances are fetched
    // up front for the asset picker, so the mock must be in place BEFORE
    // entering the wizard — `conversation.external` caches the result
    // and replays it on the asset-pick turn.
    const balanceHandler = async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      const body = JSON.parse((init as RequestInit).body as string) as {
        method: string;
      };
      if (body.method === "eth_getBalance") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: "0x14d1120d7b160000",
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({}), { status: 500 });
    };

    withTelegramOk(fetchSpy, balanceHandler);
    await h.run(callbackUpdate(START_CALLBACK.withdraw, 1));
    fetchSpy.mockClear();
    withTelegramOk(fetchSpy, balanceHandler);
    await h.run(callbackUpdate("wda:hype", 2));

    const sends = captureTg(fetchSpy).filter((c) =>
      c.url.includes("/sendMessage"),
    );
    const amountPrompt = sends.find((c) =>
      /How much HYPE/.test(c.body.text as string),
    );
    expect(amountPrompt).toBeDefined();
    expect(String(amountPrompt!.body.text)).toMatch(
      /Your HYPE balance is 1\.5 HYPE/,
    );
  });

  it("asset picker shows both USDC and HYPE balances inline with the buttons", async () => {
    const h = makeBotHarness();
    await ensureActiveWallet(h);
    await buildPm(h).setPin(USER_ID, "123456");

    // 25 USDC (6dp) and 1.5 HYPE (18dp). Same handler shape as above —
    // both balances are now read up front for the picker so we mock the
    // ERC20 `eth_call` leg as well as `eth_getBalance`.
    const balanceHandler = async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      const body = JSON.parse((init as RequestInit).body as string) as {
        method: string;
      };
      if (body.method === "eth_getBalance") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: "0x14d1120d7b160000",
          }),
          { status: 200 },
        );
      }
      if (body.method === "eth_call") {
        // 25_000_000 in 32-byte hex
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result:
              "0x00000000000000000000000000000000000000000000000000000000017d7840",
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({}), { status: 500 });
    };

    withTelegramOk(fetchSpy, balanceHandler);
    await h.run(callbackUpdate(START_CALLBACK.withdraw, 1));

    const sends = captureTg(fetchSpy).filter((c) =>
      c.url.includes("/sendMessage"),
    );
    const prompt = sends.find((c) =>
      /Which asset\?/.test(c.body.text as string),
    );
    expect(prompt).toBeDefined();
    const text = String(prompt!.body.text);
    expect(text).toMatch(/You have 25 USDC and 1\.5 HYPE\./);

    const keyboard = (
      prompt!.body.reply_markup as {
        inline_keyboard: { text: string; callback_data: string }[][];
      }
    ).inline_keyboard;
    // First row: USDC on the left, HYPE on the right.
    expect(keyboard[0]?.[0]?.text).toBe("USDC");
    expect(keyboard[0]?.[0]?.callback_data).toBe("wda:usdc");
    expect(keyboard[0]?.[1]?.text).toBe("HYPE");
    expect(keyboard[0]?.[1]?.callback_data).toBe("wda:hype");
    // Second row: Back + Home — global nav row, not asset-specific.
    expect(keyboard[1]?.map((b) => b.callback_data)).toEqual([
      "nav:b",
      "nav:h",
    ]);
  });

  it("amount prompt falls back to 'unavailable' when the RPC read fails", async () => {
    const h = makeBotHarness();
    await ensureActiveWallet(h);
    await buildPm(h).setPin(USER_ID, "123456");

    // The default mockTelegramOk throws on any non-Telegram fetch; the
    // rpc helpers catch that and return null, so the prompt must
    // degrade gracefully rather than leaking the underlying error.
    await h.run(callbackUpdate(START_CALLBACK.withdraw, 1));
    fetchSpy.mockClear();
    mockTelegramOk(fetchSpy);
    await h.run(callbackUpdate("wda:hype", 2));

    const sends = captureTg(fetchSpy).filter((c) =>
      c.url.includes("/sendMessage"),
    );
    const amountPrompt = sends.find((c) =>
      /How much HYPE/.test(c.body.text as string),
    );
    expect(amountPrompt).toBeDefined();
    expect(String(amountPrompt!.body.text)).toMatch(
      /Your HYPE balance is unavailable/,
    );
  });

  it("summary includes the available balance and warns when the amount exceeds it", async () => {
    const h = makeBotHarness();
    await ensureActiveWallet(h);
    await buildPm(h).setPin(USER_ID, "123456");

    // 0.05 HYPE in wei = 5e16 = 0xb1a2bc2ec50000 — below the 0.1 HYPE
    // the wizard collects below, so the summary must warn.
    const balanceHandler = async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      const body = JSON.parse((init as RequestInit).body as string) as {
        method: string;
      };
      if (body.method === "eth_getBalance") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: "0xb1a2bc2ec50000",
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({}), { status: 500 });
    };

    await h.run(callbackUpdate(START_CALLBACK.withdraw, 1));
    fetchSpy.mockClear();
    withTelegramOk(fetchSpy, balanceHandler);
    await h.run(callbackUpdate("wda:hype", 2));
    fetchSpy.mockClear();
    withTelegramOk(fetchSpy, balanceHandler);
    await h.run(textUpdate("0.1", 3));
    fetchSpy.mockClear();
    withTelegramOk(fetchSpy, balanceHandler);
    await h.run(textUpdate(DEST, 4));
    fetchSpy.mockClear();
    withTelegramOk(fetchSpy, balanceHandler);
    await h.run(textUpdate("123456", 30));

    const sends = captureTg(fetchSpy).filter((c) =>
      c.url.includes("/sendMessage"),
    );
    const summary = sends.find((c) =>
      /Withdraw summary/.test(c.body.text as string),
    );
    expect(summary).toBeDefined();
    const text = String(summary!.body.text);
    expect(text).toMatch(/Available balance: 0\.05 HYPE/);
    expect(text).toMatch(/exceeds available balance/);
  });

  it("rejects before the PIN prompt when the withdrawal lock is enabled", async () => {
    const h = makeBotHarness();
    await ensureActiveWallet(h);
    await buildPm(h).setPin(USER_ID, "123456");
    await buildSec(h).enableWithdrawLock(USER_ID);

    await enterAndAnswerWizard(h, fetchSpy);

    const sends = captureTg(fetchSpy).filter((c) =>
      c.url.includes("/sendMessage"),
    );
    // Last message after the destination prompt is the lock rejection.
    const lockReply = sends.find((c) =>
      /Withdrawal lock is on/.test(c.body.text as string),
    );
    expect(lockReply).toBeDefined();
    // No PIN prompt should have surfaced.
    const pinPrompt = sends.find((c) =>
      /Send your 6-digit PIN/.test(c.body.text as string),
    );
    expect(pinPrompt).toBeUndefined();
  });

  it("wrong PIN increments the attempt counter and lockout kicks in at 5", async () => {
    const h = makeBotHarness();
    await ensureActiveWallet(h);
    await buildPm(h).setPin(USER_ID, "123456");

    await enterAndAnswerWizard(h, fetchSpy);

    // The bot is now prompting for the PIN. Send four wrong PINs.
    for (let i = 0; i < 4; i++) {
      fetchSpy.mockClear();
      mockTelegramOk(fetchSpy);
      await h.run(textUpdate("000000", 10 + i));
    }
    const attemptsRaw = await h.kv.get("pin:7:attempts");
    expect(attemptsRaw).toBeDefined();
    const attempts = JSON.parse(String(attemptsRaw)) as {
      count: number;
      lockedUntil: number;
    };
    expect(attempts.count).toBe(4);
    expect(attempts.lockedUntil).toBe(0);

    // Fifth wrong PIN flips the user into lockout and ends the
    // conversation with a "locked" reply.
    fetchSpy.mockClear();
    mockTelegramOk(fetchSpy);
    await h.run(textUpdate("000000", 20));
    const locked = captureTg(fetchSpy).find((c) =>
      /locked for/.test(c.body.text as string),
    );
    expect(locked).toBeDefined();
    const after = JSON.parse(String(await h.kv.get("pin:7:attempts"))) as {
      count: number;
      lockedUntil: number;
    };
    expect(after.lockedUntil).toBeGreaterThan(Date.now());
  });

  it("confirm tap after the 60s window is a no-op (no eth_sendRawTransaction)", async () => {
    const h = makeBotHarness();
    await ensureActiveWallet(h);
    await buildPm(h).setPin(USER_ID, "123456");

    await enterAndAnswerWizard(h, fetchSpy);
    fetchSpy.mockClear();
    mockTelegramOk(fetchSpy);
    await h.run(textUpdate("123456", 30));

    // The summary message exists and carries a Confirm button — pull the
    // nonce out of its callback_data so we can replay it after expiry.
    const summary = captureTg(fetchSpy).find((c) =>
      c.url.includes("/sendMessage") &&
      /Withdraw summary/.test(c.body.text as string),
    );
    expect(summary).toBeDefined();
    const keyboard = (
      summary!.body.reply_markup as {
        inline_keyboard: { callback_data: string }[][];
      }
    ).inline_keyboard;
    const confirmBtn = keyboard.flat().find((b) =>
      b.callback_data.startsWith("wdc:"),
    );
    expect(confirmBtn).toBeDefined();
    const nonce = confirmBtn!.callback_data.slice("wdc:".length);

    // Age the staged intent past the 60s window. The session storage is
    // KV-backed; rewriting the JSON-encoded session entry is the
    // cleanest way to simulate clock skew in-process.
    const sessionRaw = await h.kv.get(`session:${USER_ID}`);
    expect(sessionRaw).toBeDefined();
    const session = JSON.parse(String(sessionRaw)) as {
      pendingWithdraw: { expiresAt: number };
    };
    session.pendingWithdraw.expiresAt = Date.now() - 1;
    await h.kv.put(`session:${USER_ID}`, JSON.stringify(session));

    // Wrap fetch so a sneaky RPC call would fail the test loudly.
    let sawRawTx = false;
    withTelegramOk(fetchSpy, async (input) => {
      if (String(input).includes("eth_sendRawTransaction")) sawRawTx = true;
      return new Response(JSON.stringify({}), { status: 500 });
    });

    fetchSpy.mockClear();
    withTelegramOk(fetchSpy, async (_input, init) => {
      const body = JSON.parse((init as RequestInit).body as string) as {
        method?: string;
      };
      if (body.method === "eth_sendRawTransaction") sawRawTx = true;
      return new Response(JSON.stringify({}), { status: 500 });
    });
    await h.run(callbackUpdate(`wdc:${nonce}`, 31));

    expect(sawRawTx).toBe(false);
    const answer = captureTg(fetchSpy).find((c) =>
      c.url.includes("/answerCallbackQuery"),
    );
    expect(answer).toBeDefined();
    expect(String(answer!.body.text)).toMatch(/expired/i);
  });

  it("valid flow submits eth_sendRawTransaction and replies with the tx hash", async () => {
    const h = makeBotHarness();
    await ensureActiveWallet(h);
    await buildPm(h).setPin(USER_ID, "123456");

    await enterAndAnswerWizard(h, fetchSpy);
    fetchSpy.mockClear();
    mockTelegramOk(fetchSpy);
    await h.run(textUpdate("123456", 30));

    const summary = captureTg(fetchSpy).find((c) =>
      c.url.includes("/sendMessage") &&
      /Withdraw summary/.test(c.body.text as string),
    );
    const keyboard = (
      summary!.body.reply_markup as {
        inline_keyboard: { callback_data: string }[][];
      }
    ).inline_keyboard;
    const confirmBtn = keyboard.flat().find((b) =>
      b.callback_data.startsWith("wdc:"),
    );
    const nonce = confirmBtn!.callback_data.slice("wdc:".length);

    const txHash =
      "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
    fetchSpy.mockClear();
    withTelegramOk(fetchSpy, async (_input, init) => {
      const body = JSON.parse((init as RequestInit).body as string) as {
        method: string;
      };
      const result = (() => {
        switch (body.method) {
          case "eth_chainId": return "0x3e7";
          case "eth_getTransactionCount": return "0x0";
          case "eth_gasPrice": return "0x1";
          case "eth_maxPriorityFeePerGas": return "0x1";
          case "eth_estimateGas": return "0x5208";
          case "eth_feeHistory": return {
            oldestBlock: "0x0",
            baseFeePerGas: ["0x1", "0x1"],
            gasUsedRatio: [0],
            reward: [["0x1"]],
          };
          case "eth_getBlockByNumber": return {
            baseFeePerGas: "0x1",
            number: "0x1",
            timestamp: "0x1",
          };
          case "eth_sendRawTransaction": return txHash;
          default: return null;
        }
      })();
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: 1, result }),
        { status: 200 },
      );
    });

    await h.run(callbackUpdate(`wdc:${nonce}`, 31));

    const sends = captureTg(fetchSpy).filter((c) =>
      c.url.includes("/sendMessage"),
    );
    const success = sends.find((c) =>
      String(c.body.text).includes(txHash),
    );
    expect(success).toBeDefined();
    expect(success!.body.text).toMatch(/Withdraw submitted/);
  });
});
