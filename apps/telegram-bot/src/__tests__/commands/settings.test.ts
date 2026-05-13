import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  makeBotHarness,
  mockTelegramOk,
  type BotTestHarness,
} from "../helpers/bot.js";
import {
  SETTINGS_CALLBACK,
  encodeSlippagePreset,
} from "../../keyboards/settings-actions.js";

const settingsCommand = (fromId: number) => ({
  update_id: 1,
  message: {
    message_id: 1,
    date: 0,
    chat: { id: 42, type: "private" as const },
    from: { id: fromId, is_bot: false, first_name: "Ada" },
    text: "/settings",
    entities: [{ type: "bot_command", offset: 0, length: 9 }],
  },
});

const settingsCommandInGroup = (fromId: number) => ({
  update_id: 1,
  message: {
    message_id: 1,
    date: 0,
    chat: { id: -100, type: "group" as const, title: "Test Group" },
    from: { id: fromId, is_bot: false, first_name: "Ada" },
    text: "/settings",
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

const readSession = async (h: BotTestHarness): Promise<{
  slippageBps: number;
  defaultBuyUsdc: number;
  degenMode: boolean;
}> => {
  const raw = await h.kv.get("session:7");
  if (typeof raw !== "string") {
    throw new Error("session not persisted");
  }
  return JSON.parse(raw) as {
    slippageBps: number;
    defaultBuyUsdc: number;
    degenMode: boolean;
  };
};

describe("/settings command", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
    mockTelegramOk(fetchSpy);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  describe("status view", () => {
    it("renders defaults (1% / $20 / degen on) on a brand-new account", async () => {
      const h = makeBotHarness();
      await h.run(settingsCommand(7));
      const send = capture(fetchSpy).find((c) =>
        c.url.includes("/sendMessage"),
      );
      expect(send).toBeDefined();
      const text = send!.body.text as string;
      expect(text).toContain("Slippage: 1%");
      expect(text).toContain("Default buy: $20 USDC");
      expect(text).toContain("Degen mode: on");
      expect(text).not.toContain("Anti-phishing phrase lives in /security");
    });

    it("marks the current slippage preset with bullets and shows the buy amount on its button", async () => {
      const h = makeBotHarness();
      await h.run(settingsCommand(7));
      const send = capture(fetchSpy).find((c) =>
        c.url.includes("/sendMessage"),
      );
      const buttons = (
        send!.body.reply_markup as { inline_keyboard: { text: string }[][] }
      ).inline_keyboard.flat();
      const labels = buttons.map((b) => b.text);
      expect(labels).toContain("• 1% •"); // current selection
      expect(labels).toContain("0.5%");
      expect(labels).toContain("2%");
      expect(labels).toContain("5%");
      expect(labels).toContain("Custom %");
      expect(labels).toContain("Default buy: $20");
      expect(labels).toContain("🟢 Degen mode");
    });

    it("rejects /settings in a group chat without leaking state", async () => {
      const h = makeBotHarness();
      await h.run(settingsCommandInGroup(7));
      const send = capture(fetchSpy).find((c) =>
        c.url.includes("/sendMessage"),
      );
      expect(send).toBeDefined();
      expect(send!.body.text).toMatch(/private-DM only/i);
      expect(send!.body.text).not.toMatch(/Slippage:/);
    });
  });

  describe("slippage preset buttons", () => {
    it("tapping a preset persists the new bps to the session and acknowledges", async () => {
      const h = makeBotHarness();
      // Initialise the session by surfacing the panel first.
      await h.run(settingsCommand(7));

      fetchSpy.mockClear();
      mockTelegramOk(fetchSpy);
      await h.run(callbackUpdate(encodeSlippagePreset(500)));

      const session = await readSession(h);
      expect(session.slippageBps).toBe(500);

      const calls = capture(fetchSpy);
      const ack = calls.find((c) =>
        c.url.includes("/answerCallbackQuery"),
      );
      expect(ack!.body.text).toContain("5%");
      const edit = calls.find((c) => c.url.includes("/editMessageText"));
      expect(edit!.body.text).toContain("Slippage: 5%");
    });

    it("ignores a malformed slippage preset callback payload", async () => {
      const h = makeBotHarness();
      await h.run(settingsCommand(7));
      fetchSpy.mockClear();
      mockTelegramOk(fetchSpy);
      // Looks like our prefix but has no integer — decode returns null.
      await h.run(callbackUpdate("set:slipabc"));
      const session = await readSession(h);
      // Default unchanged.
      expect(session.slippageBps).toBe(100);
    });
  });

  describe("degen-mode toggle", () => {
    it("toggles the flag off and back on across two taps", async () => {
      const h = makeBotHarness();
      await h.run(settingsCommand(7));

      fetchSpy.mockClear();
      mockTelegramOk(fetchSpy);
      await h.run(callbackUpdate(SETTINGS_CALLBACK.degenToggle));
      expect((await readSession(h)).degenMode).toBe(false);
      const offCalls = capture(fetchSpy);
      const offAck = offCalls.find((c) =>
        c.url.includes("/answerCallbackQuery"),
      );
      expect(offAck!.body.text).toMatch(/disabled/i);
      const offEdit = offCalls.find((c) => c.url.includes("/editMessageText"));
      const offLabels = (
        offEdit!.body.reply_markup as { inline_keyboard: { text: string }[][] }
      ).inline_keyboard.flat().map((b) => b.text);
      expect(offLabels).toContain("🔴 Degen mode");
      expect(offLabels).not.toContain("🟢 Degen mode");

      fetchSpy.mockClear();
      mockTelegramOk(fetchSpy);
      await h.run(callbackUpdate(SETTINGS_CALLBACK.degenToggle, 3));
      expect((await readSession(h)).degenMode).toBe(true);
      const onCalls = capture(fetchSpy);
      const onAck = onCalls.find((c) =>
        c.url.includes("/answerCallbackQuery"),
      );
      expect(onAck!.body.text).toMatch(/enabled/i);
      const onEdit = onCalls.find((c) => c.url.includes("/editMessageText"));
      const onLabels = (
        onEdit!.body.reply_markup as { inline_keyboard: { text: string }[][] }
      ).inline_keyboard.flat().map((b) => b.text);
      expect(onLabels).toContain("🟢 Degen mode");
      expect(onLabels).not.toContain("🔴 Degen mode");
    });
  });

  describe("custom slippage wizard", () => {
    it("accepts a valid percent and stores it as bps", async () => {
      const h = makeBotHarness();
      await h.run(callbackUpdate(SETTINGS_CALLBACK.slipCustom));

      fetchSpy.mockClear();
      mockTelegramOk(fetchSpy);
      await h.run(textUpdate("2.5", 3));

      const session = await readSession(h);
      expect(session.slippageBps).toBe(250);
      const reply = capture(fetchSpy).find(
        (c) =>
          c.url.includes("/sendMessage") &&
          /Slippage set to/.test(c.body.text as string),
      );
      expect(reply).toBeDefined();
      expect(reply!.body.text).toContain("2.5%");
    });

    it("rejects values above the 50% cap and stays in the wizard", async () => {
      const h = makeBotHarness();
      await h.run(callbackUpdate(SETTINGS_CALLBACK.slipCustom));

      fetchSpy.mockClear();
      mockTelegramOk(fetchSpy);
      await h.run(textUpdate("100", 3));

      const session = await readSession(h);
      // Default unchanged — wizard rejected the input.
      expect(session.slippageBps).toBe(100);
      const reply = capture(fetchSpy).find(
        (c) =>
          c.url.includes("/sendMessage") &&
          /capped at 50%/i.test(c.body.text as string),
      );
      expect(reply).toBeDefined();
    });

    it("rejects non-numeric input and stays in the wizard", async () => {
      const h = makeBotHarness();
      await h.run(callbackUpdate(SETTINGS_CALLBACK.slipCustom));

      fetchSpy.mockClear();
      mockTelegramOk(fetchSpy);
      await h.run(textUpdate("nope", 3));

      const reply = capture(fetchSpy).find(
        (c) =>
          c.url.includes("/sendMessage") &&
          /positive number/i.test(c.body.text as string),
      );
      expect(reply).toBeDefined();
      expect((await readSession(h)).slippageBps).toBe(100);
    });

    it("/cancel exits the wizard without touching the session", async () => {
      const h = makeBotHarness();
      await h.run(callbackUpdate(SETTINGS_CALLBACK.slipCustom));

      fetchSpy.mockClear();
      mockTelegramOk(fetchSpy);
      await h.run(textUpdate("/cancel", 3));

      expect((await readSession(h)).slippageBps).toBe(100);
      const reply = capture(fetchSpy).find(
        (c) =>
          c.url.includes("/sendMessage") &&
          /Cancelled/.test(c.body.text as string),
      );
      expect(reply).toBeDefined();
    });
  });

  describe("default buy amount wizard", () => {
    it("accepts a valid USDC amount and rounds to whole dollars", async () => {
      const h = makeBotHarness();
      await h.run(callbackUpdate(SETTINGS_CALLBACK.buyAmount));

      fetchSpy.mockClear();
      mockTelegramOk(fetchSpy);
      await h.run(textUpdate("$75.4", 3));

      const session = await readSession(h);
      expect(session.defaultBuyUsdc).toBe(75);
    });

    it("rejects amounts below the bot minimum and stays in the wizard", async () => {
      const h = makeBotHarness();
      await h.run(callbackUpdate(SETTINGS_CALLBACK.buyAmount));

      fetchSpy.mockClear();
      mockTelegramOk(fetchSpy);
      await h.run(textUpdate("5", 3));

      // Default unchanged.
      expect((await readSession(h)).defaultBuyUsdc).toBe(20);
      const reply = capture(fetchSpy).find(
        (c) =>
          c.url.includes("/sendMessage") &&
          /Minimum is \$/.test(c.body.text as string),
      );
      expect(reply).toBeDefined();
    });
  });
});
