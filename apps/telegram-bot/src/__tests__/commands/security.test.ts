import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  makeBotHarness,
  mockTelegramOk,
  type BotTestHarness,
} from "../helpers/bot.js";
import { SECURITY_CALLBACK } from "../../keyboards/security-actions.js";
import { PinManager, PIN_RESET_DELAY_MS } from "../../lib/pin.js";
import {
  SecurityState,
  WITHDRAW_LOCK_DISABLE_COOLDOWN_MS,
} from "../../lib/security-state.js";

const securityCommand = (fromId: number) => ({
  update_id: 1,
  message: {
    message_id: 1,
    date: 0,
    chat: { id: 42, type: "private" as const },
    from: { id: fromId, is_bot: false, first_name: "Ada" },
    text: "/security",
    entities: [{ type: "bot_command", offset: 0, length: 9 }],
  },
});

const callbackUpdate = (data: string, updateId = 2) => ({
  update_id: updateId,
  callback_query: {
    id: `cbq-${updateId}`,
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

const textUpdate = (text: string, updateId: number) => ({
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

const buildPm = (h: BotTestHarness): PinManager =>
  new PinManager(h.kv as unknown as KVNamespace, { saltRounds: 4 });

const buildSec = (h: BotTestHarness): SecurityState =>
  new SecurityState(h.kv as unknown as KVNamespace);

describe("/security command", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
    mockTelegramOk(fetchSpy);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  describe("status view", () => {
    it("renders 'PIN: not set' + Set PIN button on a brand-new account", async () => {
      const h = makeBotHarness();
      await h.run(securityCommand(7));
      const send = capture(fetchSpy).find((c) =>
        c.url.includes("/sendMessage"),
      );
      expect(send).toBeDefined();
      expect(send!.body.text).toContain("PIN: not set");
      expect(send!.body.text).toContain("Anti-phishing phrase: not set");
      expect(send!.body.text).toContain("Withdrawal lock: off");
      const keyboard = (
        send!.body.reply_markup as {
          inline_keyboard: { text: string }[][];
        }
      ).inline_keyboard;
      const buttonTexts = keyboard.flat().map((b) => b.text);
      expect(buttonTexts).toContain("Set PIN");
      expect(buttonTexts).toContain("Enable withdrawal lock");
    });

    it("renders Change/Reset PIN buttons once a PIN is set", async () => {
      const h = makeBotHarness();
      await buildPm(h).setPin(7, "123456");
      await h.run(securityCommand(7));
      const send = capture(fetchSpy).find((c) =>
        c.url.includes("/sendMessage"),
      );
      expect(send!.body.text).toContain("PIN: set");
      const buttonTexts = (
        send!.body.reply_markup as {
          inline_keyboard: { text: string }[][];
        }
      ).inline_keyboard
        .flat()
        .map((b) => b.text);
      expect(buttonTexts).toEqual(
        expect.arrayContaining(["Change PIN", "Reset PIN"]),
      );
    });
  });

  describe("Set PIN flow", () => {
    it("set + confirm stores a bcrypt hash (not plaintext) and the PIN verifies", async () => {
      const h = makeBotHarness();
      await h.run(callbackUpdate(SECURITY_CALLBACK.setPin));

      fetchSpy.mockClear();
      mockTelegramOk(fetchSpy);
      await h.run(textUpdate("123456", 3));
      // Bot asks to confirm — and sweeps the first PIN message.
      const afterFirst = capture(fetchSpy);
      expect(
        afterFirst.find(
          (c) =>
            c.url.includes("/sendMessage") &&
            /Confirm/.test(c.body.text as string),
        ),
      ).toBeDefined();

      fetchSpy.mockClear();
      mockTelegramOk(fetchSpy);
      await h.run(textUpdate("123456", 4));

      const pm = buildPm(h);
      expect(await pm.isPinSet(7)).toBe(true);
      // Raw KV value is the JSON-wrapped bcrypt hash, not the PIN.
      const raw = await h.kv.get("pin:7:hash");
      expect(raw).toBeDefined();
      expect(String(raw)).not.toContain("123456");
      expect(String(raw)).toMatch(/\$2[aby]\$/);
      // The freshly-set PIN verifies.
      const ok = await pm.verifyPin(7, "123456");
      expect(ok.ok).toBe(true);
    });

    it("rejects malformed PIN and stays in the wizard", async () => {
      const h = makeBotHarness();
      await h.run(callbackUpdate(SECURITY_CALLBACK.setPin));

      fetchSpy.mockClear();
      mockTelegramOk(fetchSpy);
      await h.run(textUpdate("abc", 3));
      const reply = capture(fetchSpy).find(
        (c) =>
          c.url.includes("/sendMessage") &&
          /PIN must be exactly 6 digits/.test(c.body.text as string),
      );
      expect(reply).toBeDefined();
      expect(await buildPm(h).isPinSet(7)).toBe(false);
    });
  });

  describe("Anti-phishing phrase flow", () => {
    it("stores the phrase on the grammY session and shows it in the status panel", async () => {
      const h = makeBotHarness();
      await h.run(callbackUpdate(SECURITY_CALLBACK.setPhrase));

      fetchSpy.mockClear();
      mockTelegramOk(fetchSpy);
      await h.run(textUpdate("blue heron", 3));

      // Status panel reflects the new phrase.
      fetchSpy.mockClear();
      mockTelegramOk(fetchSpy);
      await h.run(securityCommand(7));
      const send = capture(fetchSpy).find((c) =>
        c.url.includes("/sendMessage"),
      );
      expect(send!.body.text).toContain('Anti-phishing phrase: "blue heron"');
    });

    it("prepends the saved phrase to every subsequent bot message", async () => {
      const h = makeBotHarness();
      await h.run(callbackUpdate(SECURITY_CALLBACK.setPhrase));

      fetchSpy.mockClear();
      mockTelegramOk(fetchSpy);
      await h.run(textUpdate("blue heron", 3));

      fetchSpy.mockClear();
      mockTelegramOk(fetchSpy);
      await h.run(securityCommand(7));
      const send = capture(fetchSpy).find((c) =>
        c.url.includes("/sendMessage"),
      );
      expect(send).toBeDefined();
      // Header sits at the top of the body — no static fallback below it.
      const text = send!.body.text as string;
      expect(text.startsWith("blue heron\n\n")).toBe(true);
      expect(text).not.toContain(
        "This bot will never ask for your seed phrase",
      );
    });

    it("rejects a phrase that exceeds 64 chars and stays in the wizard", async () => {
      const h = makeBotHarness();
      await h.run(callbackUpdate(SECURITY_CALLBACK.setPhrase));

      fetchSpy.mockClear();
      mockTelegramOk(fetchSpy);
      const tooLong = "x".repeat(65);
      await h.run(textUpdate(tooLong, 3));
      const reply = capture(fetchSpy).find(
        (c) =>
          c.url.includes("/sendMessage") &&
          /Phrase too long/.test(c.body.text as string),
      );
      expect(reply).toBeDefined();
    });
  });

  describe("Withdrawal lock flow", () => {
    it("enable button flips the flag and the panel updates to 'on'", async () => {
      const h = makeBotHarness();
      await h.run(callbackUpdate(SECURITY_CALLBACK.enableLock));
      expect((await buildSec(h).getWithdrawLock(7)).enabled).toBe(true);
      const edit = capture(fetchSpy).find((c) =>
        c.url.includes("/editMessageText"),
      );
      expect(edit!.body.text).toContain("Withdrawal lock: on");
    });

    it("disable inside the 24h cooldown surfaces a pending toast and leaves the lock on", async () => {
      const h = makeBotHarness();
      await buildSec(h).enableWithdrawLock(7);
      await h.run(callbackUpdate(SECURITY_CALLBACK.disableLock));

      const answer = capture(fetchSpy).find((c) =>
        c.url.includes("/answerCallbackQuery"),
      );
      expect((answer!.body.text as string)).toMatch(/Disable requested/);
      const lock = await buildSec(h).getWithdrawLock(7);
      expect(lock.enabled).toBe(true);
      expect(lock.disableRequestedAt).not.toBeNull();
    });

    it("disable on a not-enabled lock toasts 'Lock is not enabled' and writes nothing", async () => {
      const h = makeBotHarness();
      await h.run(callbackUpdate(SECURITY_CALLBACK.disableLock));
      const answer = capture(fetchSpy).find((c) =>
        c.url.includes("/answerCallbackQuery"),
      );
      expect(answer!.body.text).toContain("Lock is not enabled");
      expect((await buildSec(h).getWithdrawLock(7)).enabled).toBe(false);
    });

    it("disable after the cooldown elapsed clears the lock", async () => {
      // Simulate cooldown completion by stamping a 25h-old request directly
      // into KV (the in-process harness has no clock fast-forward).
      const h = makeBotHarness();
      const oldRequestedAt = Date.now() - (WITHDRAW_LOCK_DISABLE_COOLDOWN_MS + 1000);
      await h.kv.put(
        "security:7:withdraw-lock",
        JSON.stringify({ enabled: true, disableRequestedAt: oldRequestedAt }),
      );
      await h.run(callbackUpdate(SECURITY_CALLBACK.disableLock));

      const answer = capture(fetchSpy).find((c) =>
        c.url.includes("/answerCallbackQuery"),
      );
      expect(answer!.body.text).toContain("Withdrawal lock disabled");
      expect((await buildSec(h).getWithdrawLock(7)).enabled).toBe(false);
    });

    it("replaying disableLock inside the cooldown is idempotent — pending state and readyAt unchanged", async () => {
      // `/security` callbacks are intentionally state-mutating actions
      // rather than one-shot confirm buttons, so they do not carry a
      // session-nonce. The replay-safety guarantee instead comes from
      // the underlying SecurityState being idempotent: a second
      // disable tap inside the cooldown returns the original readyAt
      // and does not extend the window. This test pins that contract
      // so a future refactor that switches to a non-idempotent backend
      // would surface here rather than as a silent funds-availability
      // bug.
      const h = makeBotHarness();
      await buildSec(h).enableWithdrawLock(7);
      await h.run(callbackUpdate(SECURITY_CALLBACK.disableLock));
      const firstLock = await buildSec(h).getWithdrawLock(7);
      const firstReadyAt = firstLock.disableRequestedAt;

      fetchSpy.mockClear();
      mockTelegramOk(fetchSpy);
      await h.run(callbackUpdate(SECURITY_CALLBACK.disableLock, 3));
      const secondLock = await buildSec(h).getWithdrawLock(7);
      expect(secondLock.enabled).toBe(true);
      expect(secondLock.disableRequestedAt).toBe(firstReadyAt);
    });

    it("replaying enableLock when already enabled is a no-op (lock stays enabled, no pending request introduced)", async () => {
      const h = makeBotHarness();
      await h.run(callbackUpdate(SECURITY_CALLBACK.enableLock));
      const before = await buildSec(h).getWithdrawLock(7);
      await h.run(callbackUpdate(SECURITY_CALLBACK.enableLock, 3));
      const after = await buildSec(h).getWithdrawLock(7);
      expect(after).toEqual(before);
    });

    it("cancelDisable wipes the pending request and keeps the lock on", async () => {
      const h = makeBotHarness();
      await buildSec(h).enableWithdrawLock(7);
      await buildSec(h).requestDisableWithdrawLock(7);
      await h.run(callbackUpdate(SECURITY_CALLBACK.cancelDisable));
      const lock = await buildSec(h).getWithdrawLock(7);
      expect(lock.enabled).toBe(true);
      expect(lock.disableRequestedAt).toBeNull();
    });
  });

  describe("PIN reset flow", () => {
    it("Reset PIN records a pending request and the panel reflects it", async () => {
      const h = makeBotHarness();
      await buildPm(h).setPin(7, "123456");
      await h.run(callbackUpdate(SECURITY_CALLBACK.resetPin));

      const status = await buildPm(h).getResetStatus(7);
      expect(status.kind).toBe("pending");
      const edit = capture(fetchSpy).find((c) =>
        c.url.includes("/editMessageText"),
      );
      expect(edit!.body.text).toMatch(/PIN: reset requested/);
    });

    it("replaying Reset PIN tap inside the cooldown is idempotent — requestedAt unchanged", async () => {
      // Same rationale as the withdraw-lock replay test above:
      // `/security` callbacks aren't nonce-gated, and the safety
      // property is that the underlying PinManager keeps the original
      // requestedAt across replays so a second tap doesn't extend the
      // cooldown.
      const h = makeBotHarness();
      const pm = buildPm(h);
      await pm.setPin(7, "123456");
      await h.run(callbackUpdate(SECURITY_CALLBACK.resetPin));
      const first = await pm.getResetStatus(7);
      if (first.kind === "none") throw new Error("expected pending");
      await h.run(callbackUpdate(SECURITY_CALLBACK.resetPin, 3));
      const second = await pm.getResetStatus(7);
      if (second.kind === "none") throw new Error("expected pending");
      expect(second.requestedAt).toBe(first.requestedAt);
    });

    it("the old PIN still verifies during the cooldown window", async () => {
      const h = makeBotHarness();
      const pm = buildPm(h);
      await pm.setPin(7, "123456");
      await h.run(callbackUpdate(SECURITY_CALLBACK.resetPin));
      const ok = await pm.verifyPin(7, "123456");
      expect(ok.ok).toBe(true);
    });

    it("Cancel PIN reset wipes the pending request", async () => {
      const h = makeBotHarness();
      const pm = buildPm(h);
      await pm.setPin(7, "123456");
      await pm.requestReset(7);
      await h.run(callbackUpdate(SECURITY_CALLBACK.cancelReset));
      expect((await pm.getResetStatus(7)).kind).toBe("none");
    });

    it("Complete reset before 24h tells the user how long is left and leaves the old PIN intact", async () => {
      const h = makeBotHarness();
      const pm = buildPm(h);
      await pm.setPin(7, "123456");
      await pm.requestReset(7);
      await h.run(callbackUpdate(SECURITY_CALLBACK.completeReset));

      const wizard = capture(fetchSpy).find(
        (c) =>
          c.url.includes("/sendMessage") &&
          /reset not yet available/i.test(c.body.text as string),
      );
      expect(wizard).toBeDefined();
      // Old PIN unchanged.
      const ok = await pm.verifyPin(7, "123456");
      expect(ok.ok).toBe(true);
    });

    it("Complete reset after 24h replaces the PIN with a freshly-confirmed new one", async () => {
      const h = makeBotHarness();
      const pm = buildPm(h);
      await pm.setPin(7, "123456");
      // Stamp an old reset request directly so the harness doesn't have
      // to fast-forward 24 hours of bcrypt + KV.
      const oldRequestedAt = Date.now() - (PIN_RESET_DELAY_MS + 1000);
      await h.kv.put(
        "pin:7:reset",
        JSON.stringify({ requestedAt: oldRequestedAt }),
      );

      await h.run(callbackUpdate(SECURITY_CALLBACK.completeReset));
      // Turn 1: send new PIN.
      fetchSpy.mockClear();
      mockTelegramOk(fetchSpy);
      await h.run(textUpdate("999999", 3));
      // Turn 2: confirm.
      fetchSpy.mockClear();
      mockTelegramOk(fetchSpy);
      await h.run(textUpdate("999999", 4));

      const newOk = await pm.verifyPin(7, "999999");
      expect(newOk.ok).toBe(true);
      const oldRejected = await pm.verifyPin(7, "123456");
      expect(oldRejected.ok).toBe(false);
      expect((await pm.getResetStatus(7)).kind).toBe("none");
    });
  });
});
