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
  encodeSpeedPreset,
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
  executionTipGwei?: number;
  executionTipPresetsGwei?: number[];
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

    it("renders the '-- Slippage --' and '-- Execution Speed --' section headers", async () => {
      const h = makeBotHarness();
      await h.run(settingsCommand(7));
      const send = capture(fetchSpy).find((c) =>
        c.url.includes("/sendMessage"),
      );
      const buttons = (
        send!.body.reply_markup as {
          inline_keyboard: { text: string; callback_data?: string }[][];
        }
      ).inline_keyboard.flat();
      const slipHeader = buttons.find((b) => b.text === "-- Slippage --");
      const speedHeader = buttons.find(
        (b) => b.text === "-- Execution Speed --",
      );
      expect(slipHeader).toBeDefined();
      expect(speedHeader).toBeDefined();
      // Both headers wire up to the inert `set:noop` callback so a tap
      // dismisses the spinner without mutating the panel.
      expect(slipHeader!.callback_data).toBe(SETTINGS_CALLBACK.noop);
      expect(speedHeader!.callback_data).toBe(SETTINGS_CALLBACK.noop);
    });

    it("renders Lightning / Fast / Eco inline speed buttons with Lightning active by default", async () => {
      const h = makeBotHarness();
      await h.run(settingsCommand(7));
      const send = capture(fetchSpy).find((c) =>
        c.url.includes("/sendMessage"),
      );
      const labels = (
        send!.body.reply_markup as { inline_keyboard: { text: string }[][] }
      ).inline_keyboard
        .flat()
        .map((b) => b.text);
      expect(labels).toContain("• Lightning •");
      expect(labels).toContain("Fast");
      expect(labels).toContain("Eco");
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

  describe("inline execution-speed buttons", () => {
    it("tapping Fast persists 0.15 gwei to the session and acknowledges", async () => {
      const h = makeBotHarness();
      await h.run(settingsCommand(7));

      fetchSpy.mockClear();
      mockTelegramOk(fetchSpy);
      await h.run(callbackUpdate(encodeSpeedPreset(1)));

      const session = await readSession(h);
      expect(session.executionTipGwei).toBe(0.15);

      const calls = capture(fetchSpy);
      const ack = calls.find((c) =>
        c.url.includes("/answerCallbackQuery"),
      );
      expect(ack!.body.text).toContain("Fast");
      expect(ack!.body.text).not.toContain("gwei");
      const edit = calls.find((c) => c.url.includes("/editMessageText"));
      const labels = (
        edit!.body.reply_markup as { inline_keyboard: { text: string }[][] }
      ).inline_keyboard
        .flat()
        .map((b) => b.text);
      expect(labels).toContain("• Fast •");
      expect(labels).toContain("Lightning");
      expect(labels).toContain("Eco");
      expect(edit!.body.text).toContain("Execution speed: Fast");
      expect(edit!.body.text).not.toContain("gwei");
    });

    it("tapping Eco persists 0.1 gwei", async () => {
      const h = makeBotHarness();
      await h.run(settingsCommand(7));
      fetchSpy.mockClear();
      mockTelegramOk(fetchSpy);
      await h.run(callbackUpdate(encodeSpeedPreset(2)));
      expect((await readSession(h)).executionTipGwei).toBe(0.1);
    });

    it("ignores a malformed speed-preset callback payload", async () => {
      const h = makeBotHarness();
      await h.run(settingsCommand(7));
      fetchSpy.mockClear();
      mockTelegramOk(fetchSpy);
      await h.run(callbackUpdate("set:tpsabc"));
      // No regex match → handler is never invoked, default tip is
      // preserved.
      expect((await readSession(h)).executionTipGwei).toBe(0.5);
    });

    it("ignores an out-of-range speed-preset index", async () => {
      const h = makeBotHarness();
      await h.run(settingsCommand(7));
      fetchSpy.mockClear();
      mockTelegramOk(fetchSpy);
      await h.run(callbackUpdate(encodeSpeedPreset(9)));
      // Slot 9 doesn't exist — handler answers the callback but leaves
      // the active tip pinned to the Lightning default.
      expect((await readSession(h)).executionTipGwei).toBe(0.5);
    });

    it("the '-- Slippage --' header button is inert (no session mutation)", async () => {
      const h = makeBotHarness();
      await h.run(settingsCommand(7));
      const before = await readSession(h);

      fetchSpy.mockClear();
      mockTelegramOk(fetchSpy);
      await h.run(callbackUpdate(SETTINGS_CALLBACK.noop));

      const after = await readSession(h);
      expect(after).toEqual(before);
      const calls = capture(fetchSpy);
      // The handler dismisses the spinner but does not edit the panel.
      expect(
        calls.some((c) => c.url.includes("/answerCallbackQuery")),
      ).toBe(true);
      expect(
        calls.some((c) => c.url.includes("/editMessageText")),
      ).toBe(false);
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

      // Wizard prompts now edit the originating /settings bubble in
      // place when an origin is available — accept both endpoints.
      const prompt = capture(fetchSpy).find(
        (c) =>
          (c.url.includes("/sendMessage") ||
            c.url.includes("/editMessageText")) &&
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

    it("edits the origin /settings bubble in place for the wizard prompt (no fresh sendMessage)", async () => {
      const h = makeBotHarness();
      await h.run(callbackUpdate(SETTINGS_CALLBACK.slipCustom));

      const calls = capture(fetchSpy);
      // Prompt lands as an edit on the originating settings bubble
      // (callbackUpdate sets message_id=100) — not a fresh
      // sendMessage that would stack the prompt below the stale
      // /settings panel.
      const edit = calls.find(
        (c) =>
          c.url.includes("/editMessageText") &&
          /custom slippage percent/i.test(String(c.body.text ?? "")),
      );
      expect(edit).toBeDefined();
      expect(edit!.body.message_id).toBe(100);
      const fresh = calls.find(
        (c) =>
          c.url.includes("/sendMessage") &&
          /custom slippage percent/i.test(String(c.body.text ?? "")),
      );
      expect(fresh).toBeUndefined();
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
          (c.url.includes("/sendMessage") ||
            c.url.includes("/editMessageText")) &&
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
          (c.url.includes("/sendMessage") ||
            c.url.includes("/editMessageText")) &&
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
          (c.url.includes("/sendMessage") ||
            c.url.includes("/editMessageText")) &&
          /positive number/i.test(c.body.text as string),
      );
      expect(reply).toBeDefined();
      expect((await readSession(h)).slippageBps).toBe(1000);
    });

    it("a slash command exits the custom-slippage wizard without touching the session", async () => {
      const h = makeBotHarness();
      await h.run(callbackUpdate(SETTINGS_CALLBACK.slipCustom));

      fetchSpy.mockClear();
      mockTelegramOk(fetchSpy);
      await h.run(textUpdate("/positions", 3));

      expect((await readSession(h)).slippageBps).toBe(1000);
      // The wizard's numeric-retry copy must NOT fire — proves the slash
      // halted the conversation rather than the prompt rejecting
      // "/positions" as an invalid number and looping the user.
      const calls = capture(fetchSpy);
      expect(
        calls.some(
          (c) =>
            c.url.includes("/sendMessage") &&
            /positive number/i.test(String(c.body.text)),
        ),
      ).toBe(false);
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
      // sendMessage that would leave the stale slot row sitting
      // above the wizard's output.
      const editOnOrigin = calls.find((c) => {
        if (!c.url.includes("/editMessageText")) return false;
        if ((c.body as { message_id?: number }).message_id !== 100) return false;
        if (!String(c.body.text).includes("Buy Settings")) return false;
        const labels = (
          c.body.reply_markup as { inline_keyboard: { text: string }[][] }
        ).inline_keyboard.flat().map((b) => b.text);
        return labels.includes("✏️ 50 USDC");
      });
      expect(editOnOrigin).toBeDefined();
      const stalePost = calls.find(
        (c) =>
          c.url.includes("/sendMessage") &&
          String(c.body.text).includes("Buy Settings"),
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
      const fallback = calls.find((c) => {
        if (!c.url.includes("/sendMessage")) return false;
        if (!String(c.body.text).includes("Buy Settings")) return false;
        const labels = (
          c.body.reply_markup as { inline_keyboard: { text: string }[][] }
        ).inline_keyboard.flat().map((b) => b.text);
        return labels.includes("✏️ 50 USDC");
      });
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
          (c.url.includes("/sendMessage") ||
            c.url.includes("/editMessageText")) &&
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

    it("lays out buy presets as 3 / 2 / [back, home]", async () => {
      const h = makeBotHarness();
      await h.run(callbackUpdate(SETTINGS_CALLBACK.buySettings));

      const edit = capture(fetchSpy).find((c) =>
        c.url.includes("/editMessageText"),
      );
      const rows = (
        edit!.body.reply_markup as { inline_keyboard: { text: string }[][] }
      ).inline_keyboard;
      expect(rows).toHaveLength(3);
      expect(rows[0]!.map((b) => b.text)).toEqual([
        "✏️ 20 USDC",
        "✏️ 40 USDC",
        "✏️ 60 USDC",
      ]);
      expect(rows[1]!.map((b) => b.text)).toEqual([
        "✏️ 80 USDC",
        "✏️ 100 USDC",
      ]);
      expect(rows[2]!.map((b) => b.text)).toEqual(["← Back", "🏠 Home"]);
    });

    it("omits the numbered slot list from the buy settings body text", async () => {
      const h = makeBotHarness();
      await h.run(callbackUpdate(SETTINGS_CALLBACK.buySettings));

      const edit = capture(fetchSpy).find((c) =>
        c.url.includes("/editMessageText"),
      );
      const text = edit!.body.text as string;
      expect(text).toContain("Tap a slot to change its amount.");
      expect(text).not.toMatch(/^\d+\.\s/m);
      expect(text).not.toContain("USDC");
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
      const editOnOrigin = calls.find((c) => {
        if (!c.url.includes("/editMessageText")) return false;
        if ((c.body as { message_id?: number }).message_id !== 100) return false;
        if (!String(c.body.text).includes("Sell Settings")) return false;
        const labels = (
          c.body.reply_markup as { inline_keyboard: { text: string }[][] }
        ).inline_keyboard.flat().map((b) => b.text);
        return labels.includes("✏️ 60%");
      });
      expect(editOnOrigin).toBeDefined();
      const stalePost = calls.find(
        (c) =>
          c.url.includes("/sendMessage") &&
          String(c.body.text).includes("Sell Settings"),
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
          (c.url.includes("/sendMessage") ||
            c.url.includes("/editMessageText")) &&
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
          (c.url.includes("/sendMessage") ||
            c.url.includes("/editMessageText")) &&
          /between 1 and 100/i.test(c.body.text as string),
      );
      expect(reply).toBeDefined();
    });

    it("lays out sell presets as 3 / 2 / [back, home]", async () => {
      const h = makeBotHarness();
      await h.run(callbackUpdate(SETTINGS_CALLBACK.sellSettings));

      const edit = capture(fetchSpy).find((c) =>
        c.url.includes("/editMessageText"),
      );
      const rows = (
        edit!.body.reply_markup as { inline_keyboard: { text: string }[][] }
      ).inline_keyboard;
      expect(rows).toHaveLength(3);
      expect(rows[0]!.map((b) => b.text)).toEqual([
        "✏️ 10%",
        "✏️ 25%",
        "✏️ 50%",
      ]);
      expect(rows[1]!.map((b) => b.text)).toEqual(["✏️ 75%", "✏️ 100%"]);
      expect(rows[2]!.map((b) => b.text)).toEqual(["← Back", "🏠 Home"]);
    });

    it("omits the numbered slot list from the sell settings body text", async () => {
      const h = makeBotHarness();
      await h.run(callbackUpdate(SETTINGS_CALLBACK.sellSettings));

      const edit = capture(fetchSpy).find((c) =>
        c.url.includes("/editMessageText"),
      );
      const text = edit!.body.text as string;
      expect(text).toContain("Tap a slot to change its percent.");
      expect(text).not.toMatch(/^\d+\.\s/m);
    });
  });

  // Anti-phishing phrase moved from /security to /settings (security
  // UI consolidation). Phrase row sits above the Degen mode toggle.
  describe("Anti-phishing phrase (moved from /security)", () => {
    it("renders Set anti-phishing phrase as a single-button row when no phrase is set", async () => {
      const h = makeBotHarness();
      await h.run(settingsCommand(7));
      const send = capture(fetchSpy).find((c) =>
        c.url.includes("/sendMessage"),
      );
      const rows = (
        send!.body.reply_markup as {
          inline_keyboard: { text: string }[][];
        }
      ).inline_keyboard;
      const phraseRow = rows.find((r) =>
        r.some((b) => b.text === "Set anti-phishing phrase"),
      );
      expect(phraseRow).toBeDefined();
      expect((send!.body.text as string)).toContain(
        "Anti-phishing phrase: not set",
      );
    });

    it("saves the phrase and surfaces Change / Clear buttons", async () => {
      const h = makeBotHarness();
      await h.run(callbackUpdate(SETTINGS_CALLBACK.phraseSet));

      fetchSpy.mockClear();
      mockTelegramOk(fetchSpy);
      await h.run(textUpdate("blue heron", 3));

      fetchSpy.mockClear();
      mockTelegramOk(fetchSpy);
      await h.run(settingsCommand(7));
      const send = capture(fetchSpy).find((c) =>
        c.url.includes("/sendMessage"),
      );
      expect(send!.body.text).toContain('Anti-phishing phrase: "blue heron"');
      const buttonTexts = (
        send!.body.reply_markup as {
          inline_keyboard: { text: string }[][];
        }
      ).inline_keyboard
        .flat()
        .map((b) => b.text);
      expect(buttonTexts).toContain("Change phrase");
      expect(buttonTexts).toContain("Clear phrase");
    });

    it("Clear phrase wipes the session phrase and the panel updates", async () => {
      const h = makeBotHarness();
      await h.run(callbackUpdate(SETTINGS_CALLBACK.phraseSet));
      fetchSpy.mockClear();
      mockTelegramOk(fetchSpy);
      await h.run(textUpdate("blue heron", 3));

      fetchSpy.mockClear();
      mockTelegramOk(fetchSpy);
      await h.run(callbackUpdate(SETTINGS_CALLBACK.phraseClear, 4));
      const answer = capture(fetchSpy).find((c) =>
        c.url.includes("/answerCallbackQuery"),
      );
      expect(answer!.body.text).toContain("Phrase cleared");
      const edit = capture(fetchSpy).find((c) =>
        c.url.includes("/editMessageText"),
      );
      expect(edit!.body.text).toContain("Anti-phishing phrase: not set");
    });

    it("rejects a phrase longer than 64 chars and stays in the wizard", async () => {
      const h = makeBotHarness();
      await h.run(callbackUpdate(SETTINGS_CALLBACK.phraseSet));

      fetchSpy.mockClear();
      mockTelegramOk(fetchSpy);
      const tooLong = "x".repeat(65);
      await h.run(textUpdate(tooLong, 3));
      const reply = capture(fetchSpy).find(
        (c) =>
          (c.url.includes("/sendMessage") ||
            c.url.includes("/editMessageText")) &&
          /Phrase too long/.test(c.body.text as string),
      );
      expect(reply).toBeDefined();
    });

    it("the phrase row sits above the Degen mode toggle", async () => {
      const h = makeBotHarness();
      await h.run(settingsCommand(7));
      const send = capture(fetchSpy).find((c) =>
        c.url.includes("/sendMessage"),
      );
      const rows = (
        send!.body.reply_markup as {
          inline_keyboard: { text: string }[][];
        }
      ).inline_keyboard;
      const phraseRowIdx = rows.findIndex((r) =>
        r.some((b) => b.text.includes("anti-phishing phrase")),
      );
      const degenRowIdx = rows.findIndex((r) =>
        r.some((b) => b.text.includes("Degen mode")),
      );
      expect(phraseRowIdx).toBeGreaterThanOrEqual(0);
      expect(degenRowIdx).toBeGreaterThan(phraseRowIdx);
    });
  });
});
