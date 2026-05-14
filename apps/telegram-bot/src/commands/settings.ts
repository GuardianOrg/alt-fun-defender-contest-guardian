import { MIN_USDC_BUY_AMOUNT } from "@launchpad/shared";
import {
  type Conversation,
  createConversation,
} from "@grammyjs/conversations";
import type { Bot } from "grammy";

import type { AppContext, SessionData } from "../bot.js";
import {
  MAX_BUY_PRESET_USDC,
  normaliseBuyPresets,
  normaliseSellPresets,
} from "../keyboards/buy-sell-token.js";
import { START_CALLBACK } from "../keyboards/start-menu.js";
import {
  SETTINGS_CALLBACK,
  SLIPPAGE_PRESETS_BPS,
  buildBuySettingsKeyboard,
  buildSellSettingsKeyboard,
  buildSettingsKeyboard,
  decodeBuyPresetSlot,
  decodeSellPresetSlot,
  decodeSlippagePreset,
  formatBpsLabel,
  type SettingsStatus,
} from "../keyboards/settings-actions.js";
import { wrapWithCtxPhrase as wrap } from "../lib/anti-phishing.js";
import { tryAddressBuyIntercept } from "../lib/conversation-commands.js";
import { parseUserAmount } from "../lib/parse-number.js";
import {
  sweepWorkflow,
  trackWorkflowMessage,
} from "../lib/workflow-stack-conversation.js";

const NO_USER_REPLY =
  "Settings require a personal Telegram account — this message has no user attached (channel post or anonymous admin).";

const NON_PRIVATE_CHAT_REPLY =
  "Settings are private-DM only — your slippage and buy defaults should not surface in groups. Open a direct chat with the bot to manage settings.";

/**
 * Cap to keep a typo'd "1000%" slippage from blowing past the
 * `slippageBps ≤ 10_000` guard in `lib/trade.ts`. 50% is more than
 * any plausible legitimate setting; anything past this is a footgun.
 */
const MAX_SLIPPAGE_BPS = 5_000;

const BUY_PRESETS_LENGTH = 5;
const SELL_PRESETS_LENGTH = 5;

const isPrivateChat = (ctx: AppContext): boolean =>
  ctx.chat?.type === "private";

const ensurePrivate = async (ctx: AppContext): Promise<boolean> => {
  if (isPrivateChat(ctx)) return true;
  await ctx.answerCallbackQuery({
    text: "Settings actions are private-DM only.",
    show_alert: true,
  });
  return false;
};

const isCancel = (text: string): boolean => text.trim() === "/cancel";

const readStatus = (ctx: AppContext): SettingsStatus => ({
  slippageBps: ctx.session.slippageBps,
  defaultBuyUsdc: ctx.session.defaultBuyUsdc,
  degenMode: ctx.session.degenMode,
});

const readBuyPresets = (session: SessionData): number[] =>
  normaliseBuyPresets(session.buyPresetsUsdc, session.defaultBuyUsdc);

const readSellPresets = (session: SessionData): number[] =>
  normaliseSellPresets(session.sellPresetsPct);

const renderMainStatusText = (status: SettingsStatus): string =>
  [
    "Settings",
    "",
    `• Slippage: ${formatBpsLabel(status.slippageBps)}`,
    `• Degen mode: ${status.degenMode ? "on" : "off"}`,
    "",
    "Tap Buy Settings or Sell Settings to customize the preset buttons.",
  ].join("\n");

const renderBuySettingsText = (presets: readonly number[]): string =>
  [
    "Buy Settings",
    "",
    "Tap a slot to change its amount.",
    "",
    ...presets.map((amount, idx) => `${idx + 1}. ${amount} USDC`),
  ].join("\n");

const renderSellSettingsText = (presets: readonly number[]): string =>
  [
    "Sell Settings",
    "",
    "Tap a slot to change its percent.",
    "",
    ...presets.map((pct, idx) => `${idx + 1}. ${pct}%`),
  ].join("\n");

interface RenderedState {
  text: string;
  reply_markup: {
    inline_keyboard: ReturnType<typeof buildSettingsKeyboard>;
  };
}

const renderMainState = (ctx: AppContext): RenderedState => {
  const status = readStatus(ctx);
  return {
    text: renderMainStatusText(status),
    reply_markup: { inline_keyboard: buildSettingsKeyboard(status) },
  };
};

const renderBuyState = (ctx: AppContext): RenderedState => {
  const presets = readBuyPresets(ctx.session);
  return {
    text: renderBuySettingsText(presets),
    reply_markup: { inline_keyboard: buildBuySettingsKeyboard(presets) },
  };
};

const renderSellState = (ctx: AppContext): RenderedState => {
  const presets = readSellPresets(ctx.session);
  return {
    text: renderSellSettingsText(presets),
    reply_markup: { inline_keyboard: buildSellSettingsKeyboard(presets) },
  };
};

/**
 * Same benign-error swallow as `commands/security.ts`. Telegram returns
 * 400 when the source message has been deleted or is unchanged; both
 * are no-ops from the user's perspective.
 */
const safeEditMessageText = async (
  ctx: AppContext,
  text: string,
  extra: Parameters<AppContext["editMessageText"]>[1] = {},
): Promise<void> => {
  try {
    await ctx.editMessageText(text, extra);
  } catch (err) {
    const e = err as {
      error_code?: number;
      description?: string;
      message?: string;
    };
    const desc = (e.description ?? e.message ?? "").toLowerCase();
    const isBenign =
      e.error_code === 400 &&
      (desc.includes("message to edit not found") ||
        desc.includes("message not found") ||
        desc.includes("message is not modified"));
    if (!isBenign) throw err;
  }
};

const editToState = async (
  ctx: AppContext,
  state: RenderedState,
): Promise<void> => {
  await safeEditMessageText(ctx, wrap(ctx, state.text), {
    reply_markup: state.reply_markup,
  });
};

/**
 * Conversation: collect a custom slippage value (percent input).
 * Stores the result on the session as bps, capped at `MAX_SLIPPAGE_BPS`.
 */
const customSlippageConversation = async (
  conversation: Conversation<AppContext, AppContext>,
  ctx: AppContext,
): Promise<void> => {
  await sweepWorkflow(conversation);
  const presetList = SLIPPAGE_PRESETS_BPS.map((bps) =>
    formatBpsLabel(bps),
  ).join(" / ");
  const promptMsg = await ctx.reply(
    wrap(
      ctx,
      [
        "Send a custom slippage percent (e.g. `0.75`, `3`, `7.5`).",
        `Quick presets: ${presetList}.`,
        `Max ${MAX_SLIPPAGE_BPS / 100}% — past that the trade lib rejects.`,
        "",
        "Send /cancel to keep the current value.",
      ].join("\n"),
    ),
  );
  await trackWorkflowMessage(conversation, promptMsg.message_id);

  while (true) {
    const msg = await conversation.waitFor("message:text");
    await trackWorkflowMessage(conversation, msg.message.message_id);
    const text = msg.message.text.trim();
    if (isCancel(text)) {
      await ctx.reply(wrap(ctx, "Cancelled."));
      await sweepWorkflow(conversation);
      return;
    }
    if (await tryAddressBuyIntercept(conversation, text)) return;
    // Use a generous outer bound here so a typo'd "1000%" still flows
    // to the explicit `bps > MAX_SLIPPAGE_BPS` cap message below
    // instead of the generic invalid-input reply. `parseUserAmount`
    // already rejects `Infinity` / NaN / `> Number.MAX_SAFE_INTEGER`.
    const pct = parseUserAmount(text.replace(/%/g, ""), {
      max: MAX_SLIPPAGE_BPS,
    });
    if (pct === null) {
      const retry = await ctx.reply(
        wrap(ctx, "Send a positive number like `2` or `0.5`, or /cancel."),
      );
      await trackWorkflowMessage(conversation, retry.message_id);
      continue;
    }
    const bps = Math.round(pct * 100);
    if (bps < 1) {
      const retry = await ctx.reply(
        wrap(ctx, "Slippage must be at least 0.01%. Send again or /cancel."),
      );
      await trackWorkflowMessage(conversation, retry.message_id);
      continue;
    }
    if (bps > MAX_SLIPPAGE_BPS) {
      const retry = await ctx.reply(
        wrap(
          ctx,
          `Slippage capped at ${MAX_SLIPPAGE_BPS / 100}% — send a smaller value or /cancel.`,
        ),
      );
      await trackWorkflowMessage(conversation, retry.message_id);
      continue;
    }
    try {
      await conversation.external((outside) => {
        outside.session.slippageBps = bps;
      });
    } catch {
      // Defence-in-depth: a synchronous throw from `external` (rare —
      // most KV failures surface at session-flush time, outside this
      // catch) must never reach a "saved" reply. The session plugin's
      // own flush errors land on `bot.catch` in `bot.ts`.
      await ctx.reply(wrap(ctx, "Failed to save — please retry."));
      await sweepWorkflow(conversation);
      return;
    }
    const state = await conversation.external((outside) =>
      renderMainState(outside),
    );
    await ctx.reply(
      wrap(ctx, `Slippage set to ${formatBpsLabel(bps)}.\n\n${state.text}`),
      { reply_markup: state.reply_markup },
    );
    await sweepWorkflow(conversation);
    return;
  }
};

/**
 * Conversation: edit one slot of the buy-preset list (issue #818).
 * `slotIdx` is the 0-based slot the user tapped. Stores the parsed
 * amount in `session.buyPresetsUsdc[slotIdx]` and, if `slotIdx === 0`,
 * mirrors it into `session.defaultBuyUsdc` so callsites still reading
 * the legacy field don't drift from slot 0.
 */
const buyPresetSlotConversation = async (
  conversation: Conversation<AppContext, AppContext>,
  ctx: AppContext,
  slotIdx: number,
): Promise<void> => {
  if (!Number.isInteger(slotIdx) || slotIdx < 0 || slotIdx >= BUY_PRESETS_LENGTH) {
    return;
  }
  await sweepWorkflow(conversation);
  const promptMsg = await ctx.reply(
    wrap(
      ctx,
      [
        "Change the value of the buy amount button.",
        "",
        `Send a USDC amount between $${MIN_USDC_BUY_AMOUNT} and $${MAX_BUY_PRESET_USDC}.`,
        "",
        "Send /cancel to keep the current value.",
      ].join("\n"),
    ),
  );
  await trackWorkflowMessage(conversation, promptMsg.message_id);

  while (true) {
    const msg = await conversation.waitFor("message:text");
    await trackWorkflowMessage(conversation, msg.message.message_id);
    const text = msg.message.text.trim();
    if (isCancel(text)) {
      await ctx.reply(wrap(ctx, "Cancelled."));
      await sweepWorkflow(conversation);
      return;
    }
    if (await tryAddressBuyIntercept(conversation, text)) return;
    const value = parseUserAmount(text, { max: MAX_BUY_PRESET_USDC });
    if (value === null) {
      const retry = await ctx.reply(
        wrap(ctx, "Send a positive USDC amount like `50`, or /cancel."),
      );
      await trackWorkflowMessage(conversation, retry.message_id);
      continue;
    }
    if (value < MIN_USDC_BUY_AMOUNT) {
      const retry = await ctx.reply(
        wrap(
          ctx,
          `Minimum is $${MIN_USDC_BUY_AMOUNT} USDC. Send a larger value or /cancel.`,
        ),
      );
      await trackWorkflowMessage(conversation, retry.message_id);
      continue;
    }
    if (value > MAX_BUY_PRESET_USDC) {
      const retry = await ctx.reply(
        wrap(
          ctx,
          `Capped at $${MAX_BUY_PRESET_USDC} USDC. Send a smaller value or /cancel.`,
        ),
      );
      await trackWorkflowMessage(conversation, retry.message_id);
      continue;
    }
    const rounded = Math.round(value);
    try {
      await conversation.external((outside) => {
        const current = normaliseBuyPresets(
          outside.session.buyPresetsUsdc,
          outside.session.defaultBuyUsdc,
        );
        current[slotIdx] = rounded;
        outside.session.buyPresetsUsdc = current;
        if (slotIdx === 0) {
          // Keep the legacy single-amount field synced with slot 0 so
          // call sites that still read it (action-card, /buy default)
          // never drift from the user's customised preset.
          outside.session.defaultBuyUsdc = rounded;
        }
      });
    } catch {
      await ctx.reply(wrap(ctx, "Failed to save — please retry."));
      await sweepWorkflow(conversation);
      return;
    }
    const state = await conversation.external((outside) =>
      renderBuyState(outside),
    );
    await ctx.reply(wrap(ctx, state.text), {
      reply_markup: state.reply_markup,
    });
    await sweepWorkflow(conversation);
    return;
  }
};

/**
 * Conversation: edit one slot of the sell-preset percent list.
 * Accepts integer percents in [1, 100].
 */
const sellPresetSlotConversation = async (
  conversation: Conversation<AppContext, AppContext>,
  ctx: AppContext,
  slotIdx: number,
): Promise<void> => {
  if (
    !Number.isInteger(slotIdx) ||
    slotIdx < 0 ||
    slotIdx >= SELL_PRESETS_LENGTH
  ) {
    return;
  }
  await sweepWorkflow(conversation);
  const promptMsg = await ctx.reply(
    wrap(
      ctx,
      [
        "Change the value of the sell percent button.",
        "",
        "Send a percent between 1 and 100.",
        "",
        "Send /cancel to keep the current value.",
      ].join("\n"),
    ),
  );
  await trackWorkflowMessage(conversation, promptMsg.message_id);

  while (true) {
    const msg = await conversation.waitFor("message:text");
    await trackWorkflowMessage(conversation, msg.message.message_id);
    const text = msg.message.text.trim();
    if (isCancel(text)) {
      await ctx.reply(wrap(ctx, "Cancelled."));
      await sweepWorkflow(conversation);
      return;
    }
    if (await tryAddressBuyIntercept(conversation, text)) return;
    const value = parseUserAmount(text.replace(/%/g, ""), { max: 100 });
    if (value === null) {
      const retry = await ctx.reply(
        wrap(ctx, "Send a number between 1 and 100, or /cancel."),
      );
      await trackWorkflowMessage(conversation, retry.message_id);
      continue;
    }
    const rounded = Math.round(value);
    if (rounded < 1 || rounded > 100) {
      const retry = await ctx.reply(
        wrap(ctx, "Percent must be between 1 and 100. Send again or /cancel."),
      );
      await trackWorkflowMessage(conversation, retry.message_id);
      continue;
    }
    try {
      await conversation.external((outside) => {
        const current = normaliseSellPresets(outside.session.sellPresetsPct);
        current[slotIdx] = rounded;
        outside.session.sellPresetsPct = current;
      });
    } catch {
      await ctx.reply(wrap(ctx, "Failed to save — please retry."));
      await sweepWorkflow(conversation);
      return;
    }
    const state = await conversation.external((outside) =>
      renderSellState(outside),
    );
    await ctx.reply(wrap(ctx, state.text), {
      reply_markup: state.reply_markup,
    });
    await sweepWorkflow(conversation);
    return;
  }
};

export const registerSettingsCommand = (bot: Bot<AppContext>): void => {
  bot.use(
    createConversation(customSlippageConversation, "settings-custom-slippage"),
  );
  bot.use(
    createConversation(
      buyPresetSlotConversation as (
        conv: Conversation<AppContext, AppContext>,
        ctx: AppContext,
        ...args: unknown[]
      ) => Promise<void>,
      "settings-buy-preset-slot",
    ),
  );
  bot.use(
    createConversation(
      sellPresetSlotConversation as (
        conv: Conversation<AppContext, AppContext>,
        ctx: AppContext,
        ...args: unknown[]
      ) => Promise<void>,
      "settings-sell-preset-slot",
    ),
  );

  bot.command("settings", async (ctx) => {
    if (!ctx.from) {
      // Channel-post / anonymous-admin updates have no `from`; reply without
      // the anti-phishing wrap because there is no per-user phrase to attach.
      await ctx.reply(NO_USER_REPLY);
      return;
    }
    if (!isPrivateChat(ctx)) {
      // Plain reply — wrapping would leak the user's anti-phishing phrase
      // into the group transcript, which is exactly what /security keeps
      // out of non-DM surfaces.
      await ctx.reply(NON_PRIVATE_CHAT_REPLY);
      return;
    }
    const state = renderMainState(ctx);
    await ctx.reply(wrap(ctx, state.text), {
      reply_markup: state.reply_markup,
    });
  });

  bot.callbackQuery(START_CALLBACK.settings, async (ctx) => {
    if (!ctx.from) {
      await ctx.answerCallbackQuery({ text: "Missing user." });
      return;
    }
    if (!(await ensurePrivate(ctx))) return;
    const state = renderMainState(ctx);
    await ctx.answerCallbackQuery();
    await ctx.reply(wrap(ctx, state.text), {
      reply_markup: state.reply_markup,
    });
  });

  // Slippage presets share a single prefix so they can be matched with
  // one filter rather than one callback per value.
  bot.callbackQuery(
    new RegExp(`^${SETTINGS_CALLBACK.slipPreset}\\d+$`),
    async (ctx) => {
      if (!ctx.from) {
        await ctx.answerCallbackQuery();
        return;
      }
      if (!(await ensurePrivate(ctx))) return;
      const bps = decodeSlippagePreset(ctx.callbackQuery.data ?? "");
      if (bps === null) {
        await ctx.answerCallbackQuery();
        return;
      }
      // Clamp to the same ceiling as the custom wizard so a tampered
      // callback can't bypass it. SLIPPAGE_PRESETS_BPS values are well
      // under the cap; this is defence-in-depth.
      const clamped = Math.min(Math.max(bps, 1), MAX_SLIPPAGE_BPS);
      ctx.session.slippageBps = clamped;
      await editToState(ctx, renderMainState(ctx));
      await ctx.answerCallbackQuery({
        text: `Slippage set to ${formatBpsLabel(clamped)}.`,
      });
    },
  );

  bot.callbackQuery(SETTINGS_CALLBACK.slipCustom, async (ctx) => {
    if (!ctx.from) {
      await ctx.answerCallbackQuery();
      return;
    }
    if (!(await ensurePrivate(ctx))) return;
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter("settings-custom-slippage");
  });

  bot.callbackQuery(SETTINGS_CALLBACK.buySettings, async (ctx) => {
    if (!ctx.from) {
      await ctx.answerCallbackQuery();
      return;
    }
    if (!(await ensurePrivate(ctx))) return;
    await editToState(ctx, renderBuyState(ctx));
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(SETTINGS_CALLBACK.sellSettings, async (ctx) => {
    if (!ctx.from) {
      await ctx.answerCallbackQuery();
      return;
    }
    if (!(await ensurePrivate(ctx))) return;
    await editToState(ctx, renderSellState(ctx));
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(SETTINGS_CALLBACK.back, async (ctx) => {
    if (!ctx.from) {
      await ctx.answerCallbackQuery();
      return;
    }
    if (!(await ensurePrivate(ctx))) return;
    await editToState(ctx, renderMainState(ctx));
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(
    new RegExp(`^${SETTINGS_CALLBACK.buyPresetSlot}\\d+$`),
    async (ctx) => {
      if (!ctx.from) {
        await ctx.answerCallbackQuery();
        return;
      }
      if (!(await ensurePrivate(ctx))) return;
      const idx = decodeBuyPresetSlot(ctx.callbackQuery.data ?? "");
      if (idx === null || idx < 0 || idx >= BUY_PRESETS_LENGTH) {
        await ctx.answerCallbackQuery();
        return;
      }
      await ctx.answerCallbackQuery();
      await ctx.conversation.enter("settings-buy-preset-slot", idx);
    },
  );

  bot.callbackQuery(
    new RegExp(`^${SETTINGS_CALLBACK.sellPresetSlot}\\d+$`),
    async (ctx) => {
      if (!ctx.from) {
        await ctx.answerCallbackQuery();
        return;
      }
      if (!(await ensurePrivate(ctx))) return;
      const idx = decodeSellPresetSlot(ctx.callbackQuery.data ?? "");
      if (idx === null || idx < 0 || idx >= SELL_PRESETS_LENGTH) {
        await ctx.answerCallbackQuery();
        return;
      }
      await ctx.answerCallbackQuery();
      await ctx.conversation.enter("settings-sell-preset-slot", idx);
    },
  );

  bot.callbackQuery(SETTINGS_CALLBACK.degenToggle, async (ctx) => {
    if (!ctx.from) {
      await ctx.answerCallbackQuery();
      return;
    }
    if (!(await ensurePrivate(ctx))) return;
    const next = !ctx.session.degenMode;
    ctx.session.degenMode = next;
    await editToState(ctx, renderMainState(ctx));
    await ctx.answerCallbackQuery({
      text: next ? "Degen mode enabled." : "Degen mode disabled.",
    });
  });
};
