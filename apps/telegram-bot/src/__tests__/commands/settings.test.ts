import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  makeBotHarness,
  mockTelegramOk,
  type BotTestHarness,
} from "../helpers/bot.js";
import {
  SETTINGS_CALLBACK,
  SLIPPAGE_PRESETS_BPS,
  encodeBuyPresetSlot,
  encodeSellPresetSlot,
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

interface ReadSession {
  slippageBps: number;
  defaultBuyUsdc: number;
  buyPresetsUsdc?: number[];
  sellPresetsPct?: number[];
  degenMode: boolean;
}

const readSession = async (h: BotTestHarness): Promise<ReadSession> => {
  const raw = await h.kv.get("session:7");
  if (typeof raw !== "string") {
    throw new Error("session not persisted");
  }
  return JSON.parse(raw) as ReadSession;
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
    it("renders defaults on a brand-new account", async () => {
      const h = makeBotHarness();
      await h.run(settingsCommand(7));
      const send = capture(fetchSpy).find((c) =>
        c.url.includes("/sendMessage"),
      );
      expect(send).toBeDefined();
      const text = send!.body.text as string;
      expect(text).toContain("Slippage: 10%");
      expect(text).toContain("Degen mode: on");
      expect(text).not.toContain("Anti-phishing phrase lives in /security");
    });

    it("exposes Buy Settings / Sell Settings entry buttons (issue #818)", async () => {
      const h = makeBotHarness();
      await h.run(settingsCommand(7));
      const send = capture(fetchSpy).find((c) =>
        c.url.includes("/sendMessage"),
      );
      const buttons = (
        send!.body.reply_markup as { inline_keyboard: { text: string }[][] }
      ).inline_keyboard.flat();
      const labels = buttons.map((b) => b.text);
      expect(labels).toContain("• 10% •");
      expect(labels).toContain("5%");
      expect(labels).toContain("15%");
      expect(labels).toContain("20%");
      expect(labels).toContain("Custom %");
      expect(labels).toContain("Buy Settings");
      expect(labels).toContain("Sell Settings");
      expect(labels).toContain("🟢 Degen mode");
    });

    it("exposes 5/10/15/20% as the four slippage presets (issue #816)", async () => {
      expect(SLIPPAGE_PRESETS_BPS).toEqual([500, 1000, 1500, 2000]);
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
      await h.run(settingsCommand(7));

      fetchSpy.mockClear();
      mockTelegramOk(fetchSpy);
      await h.run(callbackUpdate(encodeSlippagePreset(1500)));

      const session = await readSession(h);
      expect(session.slippageBps).toBe(1500);

      const calls = capture(fetchSpy);
      const ack = calls.find((c) =>
        c.url.includes("/answerCallbackQuery"),
      );
      expect(ack!.body.text).toContain("15%");
      const edit = calls.find((c) => c.url.includes("/editMessageText"));
      expect(edit!.body.text).toContain("Slippage: 15%");
    });

    it("ignores a malformed slippage preset callback payload", async () => {
      const h = makeBotHarness();
      await h.run(settingsCommand(7));
      fetchSpy.mockClear();
      mockTelegramOk(fetchSpy);
      await h.run(callbackUpdate("set:slipabc"));
      const session = await readSession(h);
      expect(session.slippageBps).toBe(1000);
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
    // The wizard prompt mentions "Tap Home to exit". Without the nav
    // row on the prompt itself, the user is told to tap a button that
    // isn't on the message they're reading.
    it("prompt carries the [← Back] [🏠 Home] nav row", async () => {
      const h = makeBotHarness();
      await h.run(callbackUpdate(SETTINGS_CALLBACK.slipCustom));

      const prompt = capture(fetchSpy).find(
        (c) =>
          c.url.includes("/sendMessage") &&
          /Tap Home to exit/.test(c.body.text as string),
      );
      expect(prompt).toBeDefined();
      const kb =
        (prompt!.body.reply_markup as
          | {
              inline_keyboard?: Array<
                Array<{ text: string; callback_data?: string }>
              >;
            }
          | undefined)?.inline_keyboard ?? [];
      expect(
        kb.some((row) =>
          row.some(
            (b) => b.text === "🏠 Home" && b.callback_data === "nav:h",
          ) && row.some(
            (b) => b.text === "← Back" && b.callback_data === "nav:b",
          ),
        ),
      ).toBe(true);
    });

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
      expect(session.slippageBps).toBe(1000);
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
      expect((await readSession(h)).slippageBps).toBe(1000);
    });

    it("/cancel exits the wizard without touching the session", async () => {
      const h = makeBotHarness();
      await h.run(callbackUpdate(SETTINGS_CALLBACK.slipCustom));

      fetchSpy.mockClear();
      mockTelegramOk(fetchSpy);
      await h.run(textUpdate("/cancel", 3));

      expect((await readSession(h)).slippageBps).toBe(1000);
      const reply = capture(fetchSpy).find(
        (c) =>
          c.url.includes("/sendMessage") &&
          /Cancelled/.test(c.body.text as string),
      );
      expect(reply).toBeDefined();
    });
  });

  describe("Buy Settings sub-menu (issue #818)", () => {
    it("opens the 5-slot buy preset panel with pencil-prefixed labels", async () => {
      const h = makeBotHarness();
      await h.run(settingsCommand(7));

      fetchSpy.mockClear();
      mockTelegramOk(fetchSpy);
      await h.run(callbackUpdate(SETTINGS_CALLBACK.buySettings));

      const edit = capture(fetchSpy).find((c) =>
        c.url.includes("/editMessageText"),
      );
      expect(edit).toBeDefined();
      expect(edit!.body.text).toContain("Buy Settings");
      const labels = (
        edit!.body.reply_markup as { inline_keyboard: { text: string }[][] }
      ).inline_keyboard.flat().map((b) => b.text);
      expect(labels).toContain("✏️ 20 USDC");
      expect(labels).toContain("✏️ 40 USDC");
      expect(labels).toContain("✏️ 60 USDC");
      expect(labels).toContain("✏️ 80 USDC");
      expect(labels).toContain("✏️ 100 USDC");
      expect(labels).toContain("← Back");
    });

    it("editing slot 0 persists the new amount and mirrors defaultBuyUsdc", async () => {
      const h = makeBotHarness();
      await h.run(callbackUpdate(encodeBuyPresetSlot(0)));

      fetchSpy.mockClear();
      mockTelegramOk(fetchSpy);
      await h.run(textUpdate("$50", 3));

      const session = await readSession(h);
      expect(session.buyPresetsUsdc).toEqual([50, 40, 60, 80, 100]);
      expect(session.defaultBuyUsdc).toBe(50);
    });

    it("edits the origin Buy Settings menu in place after the new value is saved", async () => {
      const h = makeBotHarness();
      await h.run(callbackUpdate(encodeBuyPresetSlot(0)));

      fetchSpy.mockClear();
      mockTelegramOk(fetchSpy);
      await h.run(textUpdate("$50", 3));

      const calls = capture(fetchSpy);
      // Refreshed panel lands as an edit on the original menu
      // (message_id 100, set by callbackUpdate), not a fresh
      // sendMessage that would leave the stale slot list sitting
      // above the wizard's output.
      const editOnOrigin = calls.find(
        (c) =>
          c.url.includes("/editMessageText") &&
          (c.body as { message_id?: number }).message_id === 100 &&
          String(c.body.text).includes("Buy Settings") &&
          String(c.body.text).includes("50 USDC"),
      );
      expect(editOnOrigin).toBeDefined();
      const stalePost = calls.find(
        (c) =>
          c.url.includes("/sendMessage") &&
          String(c.body.text).includes("Buy Settings") &&
          String(c.body.text).includes("50 USDC"),
      );
      expect(stalePost).toBeUndefined();
    });

    it("falls back to sendMessage when the origin menu is too old to edit", async () => {
      const h = makeBotHarness();
      await h.run(callbackUpdate(encodeBuyPresetSlot(0)));

      // Mock Telegram such that editMessageText returns the 400
      // "message can't be edited" Telegram surfaces for messages
      // older than ~48h; every other call still succeeds.
      fetchSpy.mockClear();
      fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/editMessageText")) {
          return new Response(
            JSON.stringify({
              ok: false,
              error_code: 400,
              description: "Bad Request: message can't be edited",
            }),
            { status: 400 },
          );
        }
        return new Response(JSON.stringify({ ok: true, result: true }), {
          status: 200,
        });
      });
      await h.run(textUpdate("$50", 3));

      const calls = capture(fetchSpy);
      // Edit attempt fired (and 400'd), then fallback panel was sent
      // as a fresh sendMessage so the user still sees the new value.
      const editAttempt = calls.find((c) =>
        c.url.includes("/editMessageText"),
      );
      expect(editAttempt).toBeDefined();
      const fallback = calls.find(
        (c) =>
          c.url.includes("/sendMessage") &&
          String(c.body.text).includes("Buy Settings") &&
          String(c.body.text).includes("50 USDC"),
      );
      expect(fallback).toBeDefined();
    });

    it("editing a non-zero slot leaves defaultBuyUsdc alone", async () => {
      const h = makeBotHarness();
      await h.run(callbackUpdate(encodeBuyPresetSlot(2)));

      fetchSpy.mockClear();
      mockTelegramOk(fetchSpy);
      await h.run(textUpdate("250", 3));

      const session = await readSession(h);
      expect(session.buyPresetsUsdc).toEqual([20, 40, 250, 80, 100]);
      expect(session.defaultBuyUsdc).toBe(20);
    });

    it("rejects amounts below the bot minimum and stays in the wizard", async () => {
      const h = makeBotHarness();
      await h.run(callbackUpdate(encodeBuyPresetSlot(1)));

      fetchSpy.mockClear();
      mockTelegramOk(fetchSpy);
      await h.run(textUpdate("5", 3));

      const session = await readSession(h);
      // Defaults are preserved unchanged — wizard rejected the input.
      expect(session.buyPresetsUsdc).toEqual([20, 40, 60, 80, 100]);
      const reply = capture(fetchSpy).find(
        (c) =>
          c.url.includes("/sendMessage") &&
          /Minimum is \$/.test(c.body.text as string),
      );
      expect(reply).toBeDefined();
    });

    it("the buy-settings sub-menu surfaces the global Back / Home row", async () => {
      const h = makeBotHarness();
      await h.run(callbackUpdate(SETTINGS_CALLBACK.buySettings));

      const edit = capture(fetchSpy).find((c) =>
        c.url.includes("/editMessageText"),
      );
      expect(edit).toBeDefined();
      const rows = (
        edit!.body.reply_markup as {
          inline_keyboard: { text: string; callback_data?: string }[][];
        }
      ).inline_keyboard;
      const last = rows[rows.length - 1]!;
      expect(last.map((b) => b.text)).toEqual(["← Back", "🏠 Home"]);
      expect(last[0]!.callback_data).toBe("nav:b");
      expect(last[1]!.callback_data).toBe("nav:h");
    });
  });

  describe("Sell Settings sub-menu (issue #818)", () => {
    it("opens the 5-slot sell preset panel with pencil-prefixed labels", async () => {
      const h = makeBotHarness();
      await h.run(callbackUpdate(SETTINGS_CALLBACK.sellSettings));

      const edit = capture(fetchSpy).find((c) =>
        c.url.includes("/editMessageText"),
      );
      expect(edit).toBeDefined();
      expect(edit!.body.text).toContain("Sell Settings");
      const labels = (
        edit!.body.reply_markup as { inline_keyboard: { text: string }[][] }
      ).inline_keyboard.flat().map((b) => b.text);
      expect(labels).toContain("✏️ 10%");
      expect(labels).toContain("✏️ 25%");
      expect(labels).toContain("✏️ 50%");
      expect(labels).toContain("✏️ 75%");
      expect(labels).toContain("✏️ 100%");
    });

    it("editing a slot persists the new percent", async () => {
      const h = makeBotHarness();
      await h.run(callbackUpdate(encodeSellPresetSlot(3)));

      fetchSpy.mockClear();
      mockTelegramOk(fetchSpy);
      await h.run(textUpdate("60%", 3));

      const session = await readSession(h);
      expect(session.sellPresetsPct).toEqual([10, 25, 50, 60, 100]);
    });

    it("edits the origin Sell Settings menu in place after the new value is saved", async () => {
      const h = makeBotHarness();
      await h.run(callbackUpdate(encodeSellPresetSlot(3)));

      fetchSpy.mockClear();
      mockTelegramOk(fetchSpy);
      await h.run(textUpdate("60%", 3));

      const calls = capture(fetchSpy);
      const editOnOrigin = calls.find(
        (c) =>
          c.url.includes("/editMessageText") &&
          (c.body as { message_id?: number }).message_id === 100 &&
          String(c.body.text).includes("Sell Settings") &&
          String(c.body.text).includes("60%"),
      );
      expect(editOnOrigin).toBeDefined();
      const stalePost = calls.find(
        (c) =>
          c.url.includes("/sendMessage") &&
          String(c.body.text).includes("Sell Settings") &&
          String(c.body.text).includes("60%"),
      );
      expect(stalePost).toBeUndefined();
    });

    it("rejects out-of-range percents and stays in the wizard", async () => {
      const h = makeBotHarness();
      await h.run(callbackUpdate(encodeSellPresetSlot(0)));

      fetchSpy.mockClear();
      mockTelegramOk(fetchSpy);
      await h.run(textUpdate("250", 3));

      const session = await readSession(h);
      // Defaults are preserved unchanged — wizard rejected the input.
      expect(session.sellPresetsPct).toEqual([10, 25, 50, 75, 100]);
      const reply = capture(fetchSpy).find(
        (c) =>
          c.url.includes("/sendMessage") &&
          /between 1 and 100/i.test(c.body.text as string),
      );
      expect(reply).toBeDefined();
    });

    it("rejects non-numeric input and stays in the wizard", async () => {
      const h = makeBotHarness();
      await h.run(callbackUpdate(encodeSellPresetSlot(0)));

      fetchSpy.mockClear();
      mockTelegramOk(fetchSpy);
      await h.run(textUpdate("nope", 3));

      const reply = capture(fetchSpy).find(
        (c) =>
          c.url.includes("/sendMessage") &&
          /between 1 and 100/i.test(c.body.text as string),
      );
      expect(reply).toBeDefined();
    });
  });
});
