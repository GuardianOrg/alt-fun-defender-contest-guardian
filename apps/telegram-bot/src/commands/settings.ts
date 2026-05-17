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
  SPEED_PRESETS,
  buildBuySettingsKeyboard,
  buildSellSettingsKeyboard,
  buildSettingsKeyboard,
  decodeBuyPresetSlot,
  decodeLanguagePreset,
  decodeSellPresetSlot,
  decodeSlippagePreset,
  decodeSpeedPreset,
  formatBpsLabel,
  formatTipPresetLabel,
  resolveActiveTipGwei,
  type SettingsStatus,
} from "../keyboards/settings-actions.js";
import {
  withAntiPhishing,
  wrapWithCtxPhrase as wrap,
} from "../lib/anti-phishing.js";
import {
  haltAndForward,
  isOtherSlashCommand,
  tryAddressBuyIntercept,
} from "../lib/conversation-commands.js";
import {
  backHomeMarkup,
  clearNavStack,
  editToSubmenu,
  pushNavSnapshot,
  snapshotFromCallback,
} from "../lib/nav.js";
import { parseUserAmount } from "../lib/parse-number.js";
import {
  sweepWorkflow,
  trackWorkflowMessage,
} from "../lib/workflow-stack-conversation.js";
import {
  DEFAULT_LANGUAGE,
  FAILED_TO_SAVE_REPLY,
  type Language,
  SETTINGS_ANTI_PHISHING_PROMPT,
  SETTINGS_BUY_SELL_HINT_REPLY,
  SETTINGS_BUY_SUBMENU_TITLE,
  SETTINGS_INVALID_NUMBER_REPLY,
  SETTINGS_INVALID_USDC_REPLY,
  SETTINGS_NO_USER_REPLY as I18N_SETTINGS_NO_USER_REPLY,
  SETTINGS_NON_PRIVATE_CHAT_REPLY as I18N_SETTINGS_NON_PRIVATE_CHAT_REPLY,
  SETTINGS_PHRASE_EMPTY_REPLY,
  SETTINGS_PRIVATE_DM_ONLY_REPLY,
  SETTINGS_SELL_SLOT_INVALID_REPLY,
  SETTINGS_SELL_SLOT_PROMPT,
  SETTINGS_SELL_SLOT_RANGE_REPLY,
  SETTINGS_SELL_SUBMENU_TITLE,
  SETTINGS_EXECUTION_SPEED_SET_REPLY,
  SETTINGS_SLIPPAGE_MIN_REPLY,
  SETTINGS_SLIPPAGE_SET_REPLY,
  TOAST_DEGEN_MODE_DISABLED,
  TOAST_DEGEN_MODE_ENABLED,
  TOAST_LANGUAGE_SET_ENGLISH,
  TOAST_LANGUAGE_SET_SIMPLIFIED_CHINESE,
  TOAST_MISSING_USER,
  TOAST_PHRASE_CLEARED,
  getCtxLanguage,
  t,
} from "../lib/i18n.js";

const noUserReply = (ctx: AppContext): string =>
  t(I18N_SETTINGS_NO_USER_REPLY, getCtxLanguage(ctx));

const nonPrivateChatReply = (ctx: AppContext): string =>
  t(I18N_SETTINGS_NON_PRIVATE_CHAT_REPLY, getCtxLanguage(ctx));

/**
 * Cap to keep a typo'd "1000%" slippage from blowing past the
 * `slippageBps ≤ 10_000` guard in `lib/trade.ts`. 50% is more than
 * any plausible legitimate setting; anything past this is a footgun.
 */
const MAX_SLIPPAGE_BPS = 5_000;

const BUY_PRESETS_LENGTH = 5;
const SELL_PRESETS_LENGTH = 5;

/**
 * Cap on the anti-phishing phrase length. Matches the legacy
 * `/security` panel limit so users coming over from the old surface
 * see the same constraint. 64 chars is more than enough for a
 * recognisable token without dominating the prefixed message body.
 */
const MAX_PHRASE_LEN = 64;

const isPrivateChat = (ctx: AppContext): boolean =>
  ctx.chat?.type === "private";

const ensurePrivate = async (ctx: AppContext): Promise<boolean> => {
  if (isPrivateChat(ctx)) return true;
  await ctx.answerCallbackQuery({
    text: t(SETTINGS_PRIVATE_DM_ONLY_REPLY, getCtxLanguage(ctx)),
    show_alert: true,
  });
  return false;
};

const readStatus = (ctx: AppContext): SettingsStatus => ({
  slippageBps: ctx.session.slippageBps,
  defaultBuyUsdc: ctx.session.defaultBuyUsdc,
  degenMode: ctx.session.degenMode,
  antiPhishingPhrase: ctx.session.antiPhishingPhrase ?? null,
  executionTipGwei: resolveActiveTipGwei(ctx.session.executionTipGwei),
  language: ctx.session.language ?? DEFAULT_LANGUAGE,
});

const readBuyPresets = (session: SessionData): number[] =>
  normaliseBuyPresets(session.buyPresetsUsdc, session.defaultBuyUsdc);

const readSellPresets = (session: SessionData): number[] =>
  normaliseSellPresets(session.sellPresetsPct);

const SETTINGS_HEADER_BY_LANG: Record<Language, string> = {
  English: "Settings",
  SimplifiedChinese: "设置",
};
const SLIPPAGE_LABEL_BY_LANG: Record<Language, string> = {
  English: "• Slippage:",
  SimplifiedChinese: "• 滑点：",
};
const EXEC_SPEED_LABEL_BY_LANG: Record<Language, string> = {
  English: "• Execution speed:",
  SimplifiedChinese: "• 执行速度：",
};
const DEGEN_LABEL_BY_LANG: Record<Language, (on: boolean) => string> = {
  English: (on) => `• Degen mode: ${on ? "on" : "off"}`,
  SimplifiedChinese: (on) => `• 极速交易模式：${on ? "开启" : "关闭"}`,
};
const PHRASE_NOT_SET_BY_LANG: Record<Language, string> = {
  English: "• Anti-phishing phrase: not set",
  SimplifiedChinese: "• 反钓鱼短语：未设置",
};
const PHRASE_SET_BY_LANG: Record<Language, (phrase: string) => string> = {
  English: (phrase) => `• Anti-phishing phrase: "${phrase}"`,
  SimplifiedChinese: (phrase) => `• 反钓鱼短语：「${phrase}」`,
};

const renderMainStatusText = (status: SettingsStatus): string => {
  const lang = status.language ?? DEFAULT_LANGUAGE;
  return [
    SETTINGS_HEADER_BY_LANG[lang],
    "",
    `${SLIPPAGE_LABEL_BY_LANG[lang]} ${formatBpsLabel(status.slippageBps)}`,
    `${EXEC_SPEED_LABEL_BY_LANG[lang]} ${formatTipPresetLabel(status.executionTipGwei, lang)}`,
    DEGEN_LABEL_BY_LANG[lang](status.degenMode),
    status.antiPhishingPhrase === null
      ? PHRASE_NOT_SET_BY_LANG[lang]
      : PHRASE_SET_BY_LANG[lang](status.antiPhishingPhrase),
    "",
    t(SETTINGS_BUY_SELL_HINT_REPLY, lang),
  ].join("\n");
};

const renderBuySettingsText = (lang: Language): string =>
  t(SETTINGS_BUY_SUBMENU_TITLE, lang);

const renderSellSettingsText = (lang: Language): string =>
  t(SETTINGS_SELL_SUBMENU_TITLE, lang);

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
  const lang = getCtxLanguage(ctx);
  const presets = readBuyPresets(ctx.session);
  return {
    text: renderBuySettingsText(lang),
    reply_markup: { inline_keyboard: buildBuySettingsKeyboard(presets, lang) },
  };
};

const renderSellState = (ctx: AppContext): RenderedState => {
  const lang = getCtxLanguage(ctx);
  const presets = readSellPresets(ctx.session);
  return {
    text: renderSellSettingsText(lang),
    reply_markup: { inline_keyboard: buildSellSettingsKeyboard(presets, lang) },
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
        desc.includes("message is not modified") ||
        desc.includes("message can't be edited"));
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
 * Origin reference to the Settings menu message the user tapped a
 * button on. Captured at callback time and threaded through the
 * wizard so the conversation can edit that same message in place for
 * the prompt, retry copy, and refreshed panel — sending fresh prompts
 * below would leave the stale menu visible above each step.
 */
interface OriginMessageRef {
  chatId: number;
  messageId: number;
}

/**
 * Same benign-error swallow as `safeEditMessageText` above. Used from
 * inside conversations via `conversation.external` to refresh the
 * origin menu in place; returns `true` only when the edit landed so
 * callers can fall back to `ctx.reply` when the original message is
 * gone (deleted, > 48h, or "not modified").
 */
const safeEditMessage = async (
  outside: AppContext,
  origin: OriginMessageRef,
  text: string,
  extra: Parameters<AppContext["api"]["editMessageText"]>[3] = {},
): Promise<boolean> => {
  try {
    await outside.api.editMessageText(
      origin.chatId,
      origin.messageId,
      text,
      extra,
    );
    return true;
  } catch (err) {
    const e = err as {
      error_code?: number;
      description?: string;
      message?: string;
    };
    const desc = (e.description ?? e.message ?? "").toLowerCase();
    if (e.error_code === 400 && desc.includes("message is not modified")) {
      // The bubble already shows exactly this text — treat as a
      // successful edit so callers don't fall back to a fresh reply
      // and stack duplicate wizard prompts (CodeRabbit #1009).
      return true;
    }
    const isBenign =
      e.error_code === 400 &&
      (desc.includes("message to edit not found") ||
        desc.includes("message not found") ||
        desc.includes("message can't be edited"));
    if (isBenign) return false;
    throw err;
  }
};

/**
 * Show a wizard prompt: edit the origin menu in place when available
 * (single-bubble UX), fall back to a fresh tracked reply when the
 * origin is gone / not threaded. `wrap` is applied here so anti-
 * phishing prepend stays consistent across all prompts.
 *
 * Used for both initial prompts and retry copy inside the slot /
 * phrase / custom-slippage conversations so the wizard runs in a
 * single bubble instead of stacking new prompts below each invalid
 * input. Caller does not need to track the message id — the fallback
 * branch tracks it for the post-wizard sweep automatically.
 */
const showPrompt = async (
  conversation: Conversation<AppContext, AppContext>,
  ctx: AppContext,
  origin: OriginMessageRef | undefined,
  text: string,
): Promise<void> => {
  if (origin) {
    const edited = await conversation.external((outside) =>
      safeEditMessage(outside, origin, wrap(outside, text), {
        reply_markup: backHomeMarkup(getCtxLanguage(outside)),
      }),
    );
    if (edited) return;
  }
  const msg = await ctx.reply(wrap(ctx, text), {
    reply_markup: backHomeMarkup(getCtxLanguage(ctx)),
  });
  await trackWorkflowMessage(conversation, msg.message_id);
};

/**
 * Conversation: collect a custom slippage value (percent input).
 * Stores the result on the session as bps, capped at `MAX_SLIPPAGE_BPS`.
 *
 * `origin` is the /settings menu the user tapped [Custom %] from; the
 * conversation edits it in place for the prompt, every retry, and the
 * refreshed panel so the flow runs in a single bubble.
 */
const customSlippageConversation = async (
  conversation: Conversation<AppContext, AppContext>,
  ctx: AppContext,
  origin?: OriginMessageRef,
): Promise<void> => {
  await sweepWorkflow(conversation);
  const presetList = SLIPPAGE_PRESETS_BPS.map((bps) =>
    formatBpsLabel(bps),
  ).join(" / ");
  await showPrompt(
    conversation,
    ctx,
    origin,
    [
      "Send a custom slippage percent (e.g. `0.75`, `3`, `7.5`).",
      `Quick presets: ${presetList}.`,
      `Max ${MAX_SLIPPAGE_BPS / 100}% — past that the trade lib rejects.`,
      "",
      "Tap Home to exit and keep the current value.",
    ].join("\n"),
  );

  while (true) {
    const msg = await conversation.waitFor("message:text");
    await trackWorkflowMessage(conversation, msg.message.message_id);
    const text = msg.message.text.trim();
    if (isOtherSlashCommand(text)) await haltAndForward(conversation);
    if (await tryAddressBuyIntercept(conversation, text)) return;
    // Use a generous outer bound here so a typo'd "1000%" still flows
    // to the explicit `bps > MAX_SLIPPAGE_BPS` cap message below
    // instead of the generic invalid-input reply. `parseUserAmount`
    // already rejects `Infinity` / NaN / `> Number.MAX_SAFE_INTEGER`.
    const pct = parseUserAmount(text.replace(/%/g, ""), {
      max: MAX_SLIPPAGE_BPS,
    });
    if (pct === null) {
      await showPrompt(
        conversation,
        ctx,
        origin,
        t(SETTINGS_INVALID_NUMBER_REPLY, getCtxLanguage(ctx)),
      );
      continue;
    }
    const bps = Math.round(pct * 100);
    if (bps < 1) {
      await showPrompt(
        conversation,
        ctx,
        origin,
        t(SETTINGS_SLIPPAGE_MIN_REPLY, getCtxLanguage(ctx)),
      );
      continue;
    }
    if (bps > MAX_SLIPPAGE_BPS) {
      await showPrompt(
        conversation,
        ctx,
        origin,
        `Slippage capped at ${MAX_SLIPPAGE_BPS / 100}% — send a smaller value.`,
      );
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
      await ctx.reply(wrap(ctx, t(FAILED_TO_SAVE_REPLY, getCtxLanguage(ctx))));
      await sweepWorkflow(conversation);
      return;
    }
    // Refresh the origin /settings panel in place when available so
    // the user lands on the updated state inside the same bubble.
    // Lead with a short confirmation line so the user can see the
    // wizard succeeded (the panel below already reflects the new
    // value, but the confirmation makes the save read unambiguous).
    const confirmation = `Slippage set to ${formatBpsLabel(bps)}.`;
    const edited = origin
      ? await conversation.external(async (outside) => {
          const state = renderMainState(outside);
          return safeEditMessage(
            outside,
            origin,
            wrap(outside, `${confirmation}\n\n${state.text}`),
            { reply_markup: state.reply_markup },
          );
        })
      : false;
    if (!edited) {
      const state = await conversation.external((outside) =>
        renderMainState(outside),
      );
      await ctx.reply(
        wrap(ctx, `${confirmation}\n\n${state.text}`),
        { reply_markup: state.reply_markup },
      );
    }
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
 *
 * `origin` is the Buy Settings menu message the user tapped from; the
 * conversation edits it in place after saving so the panel above the
 * wizard reflects the new value rather than leaving the stale list
 * visible alongside a freshly-sent panel below.
 */
const buyPresetSlotConversation = async (
  conversation: Conversation<AppContext, AppContext>,
  ctx: AppContext,
  slotIdx: number,
  origin?: OriginMessageRef,
): Promise<void> => {
  if (!Number.isInteger(slotIdx) || slotIdx < 0 || slotIdx >= BUY_PRESETS_LENGTH) {
    return;
  }
  await sweepWorkflow(conversation);
  await showPrompt(
    conversation,
    ctx,
    origin,
    [
      "Change the value of the buy amount button.",
      "",
      `Send a USDC amount between $${MIN_USDC_BUY_AMOUNT} and $${MAX_BUY_PRESET_USDC}.`,
      "",
      "Tap Home to exit and keep the current value.",
    ].join("\n"),
  );

  while (true) {
    const msg = await conversation.waitFor("message:text");
    await trackWorkflowMessage(conversation, msg.message.message_id);
    const text = msg.message.text.trim();
    if (isOtherSlashCommand(text)) await haltAndForward(conversation);
    if (await tryAddressBuyIntercept(conversation, text)) return;
    const value = parseUserAmount(text, { max: MAX_BUY_PRESET_USDC });
    if (value === null) {
      await showPrompt(
        conversation,
        ctx,
        origin,
        t(SETTINGS_INVALID_USDC_REPLY, getCtxLanguage(ctx)),
      );
      continue;
    }
    if (value < MIN_USDC_BUY_AMOUNT) {
      await showPrompt(
        conversation,
        ctx,
        origin,
        `Minimum is $${MIN_USDC_BUY_AMOUNT} USDC. Send a larger value.`,
      );
      continue;
    }
    if (value > MAX_BUY_PRESET_USDC) {
      await showPrompt(
        conversation,
        ctx,
        origin,
        `Capped at $${MAX_BUY_PRESET_USDC} USDC. Send a smaller value.`,
      );
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
      await ctx.reply(wrap(ctx, t(FAILED_TO_SAVE_REPLY, getCtxLanguage(ctx))));
      await sweepWorkflow(conversation);
      return;
    }
    const edited = origin
      ? await conversation.external(async (outside) => {
          const state = renderBuyState(outside);
          return safeEditMessage(outside, origin, wrap(outside, state.text), {
            reply_markup: state.reply_markup,
          });
        })
      : false;
    if (!edited) {
      const state = await conversation.external((outside) =>
        renderBuyState(outside),
      );
      await ctx.reply(wrap(ctx, state.text), {
        reply_markup: state.reply_markup,
      });
    }
    await sweepWorkflow(conversation);
    return;
  }
};

/**
 * Conversation: edit one slot of the sell-preset percent list.
 * Accepts integer percents in [1, 100]. `origin` is the Sell Settings
 * menu message — edited in place after save so the stale preset list
 * above the wizard prompt doesn't linger alongside a freshly-sent
 * updated panel.
 */
const sellPresetSlotConversation = async (
  conversation: Conversation<AppContext, AppContext>,
  ctx: AppContext,
  slotIdx: number,
  origin?: OriginMessageRef,
): Promise<void> => {
  if (
    !Number.isInteger(slotIdx) ||
    slotIdx < 0 ||
    slotIdx >= SELL_PRESETS_LENGTH
  ) {
    return;
  }
  await sweepWorkflow(conversation);
  await showPrompt(
    conversation,
    ctx,
    origin,
    t(SETTINGS_SELL_SLOT_PROMPT, getCtxLanguage(ctx)),
  );

  while (true) {
    const msg = await conversation.waitFor("message:text");
    await trackWorkflowMessage(conversation, msg.message.message_id);
    const text = msg.message.text.trim();
    if (isOtherSlashCommand(text)) await haltAndForward(conversation);
    if (await tryAddressBuyIntercept(conversation, text)) return;
    const value = parseUserAmount(text.replace(/%/g, ""), { max: 100 });
    if (value === null) {
      await showPrompt(
        conversation,
        ctx,
        origin,
        t(SETTINGS_SELL_SLOT_INVALID_REPLY, getCtxLanguage(ctx)),
      );
      continue;
    }
    const rounded = Math.round(value);
    if (rounded < 1 || rounded > 100) {
      await showPrompt(
        conversation,
        ctx,
        origin,
        t(SETTINGS_SELL_SLOT_RANGE_REPLY, getCtxLanguage(ctx)),
      );
      continue;
    }
    try {
      await conversation.external((outside) => {
        const current = normaliseSellPresets(outside.session.sellPresetsPct);
        current[slotIdx] = rounded;
        outside.session.sellPresetsPct = current;
      });
    } catch {
      await ctx.reply(wrap(ctx, t(FAILED_TO_SAVE_REPLY, getCtxLanguage(ctx))));
      await sweepWorkflow(conversation);
      return;
    }
    const edited = origin
      ? await conversation.external(async (outside) => {
          const state = renderSellState(outside);
          return safeEditMessage(outside, origin, wrap(outside, state.text), {
            reply_markup: state.reply_markup,
          });
        })
      : false;
    if (!edited) {
      const state = await conversation.external((outside) =>
        renderSellState(outside),
      );
      await ctx.reply(wrap(ctx, state.text), {
        reply_markup: state.reply_markup,
      });
    }
    await sweepWorkflow(conversation);
    return;
  }
};

/**
 * Conversation: set or change the anti-phishing phrase. Lives on the
 * `/settings` panel above [Degen mode]; lands the user back on a
 * refreshed settings panel whose header reflects the new phrase. The
 * inner ctx.session is a snapshot captured at enter, so the final
 * reply explicitly uses `withAntiPhishing(..., trimmed)` instead of
 * `wrap` — otherwise the header would render the pre-change phrase
 * (or static fallback) even though the body below already reflects
 * the new value.
 */
const setPhraseConversation = async (
  conversation: Conversation<AppContext, AppContext>,
  ctx: AppContext,
  origin?: OriginMessageRef,
): Promise<void> => {
  if (!ctx.from || !ctx.chat) return;
  await sweepWorkflow(conversation);
  await showPrompt(
    conversation,
    ctx,
    origin,
    [
      t(SETTINGS_ANTI_PHISHING_PROMPT, getCtxLanguage(ctx)),
      "",
      `Max ${MAX_PHRASE_LEN} characters.`,
    ].join("\n"),
  );
  while (true) {
    const reply = await conversation.waitFor("message:text");
    const text = reply.message.text;
    const trimmed = text.trim();
    if (isOtherSlashCommand(trimmed)) await haltAndForward(conversation);
    if (await tryAddressBuyIntercept(conversation, trimmed)) return;
    await trackWorkflowMessage(conversation, reply.message.message_id);
    if (trimmed.length === 0) {
      await showPrompt(
        conversation,
        ctx,
        origin,
        t(SETTINGS_PHRASE_EMPTY_REPLY, getCtxLanguage(ctx)),
      );
      continue;
    }
    if (trimmed.length > MAX_PHRASE_LEN) {
      await showPrompt(
        conversation,
        ctx,
        origin,
        `Phrase too long (${trimmed.length}/${MAX_PHRASE_LEN}). Send a shorter one.`,
      );
      continue;
    }
    await conversation.external((outside) => {
      outside.session.antiPhishingPhrase = trimmed;
    });
    const state = await conversation.external((outside) =>
      renderMainState(outside),
    );
    // Refresh the origin /settings panel in place when available so
    // the user lands on the updated phrase header inside the same
    // bubble; the trimmed phrase is what `withAntiPhishing` needs to
    // render correctly (the inner ctx.session snapshot still holds
    // the pre-change value at this point in conversation replay).
    const edited = origin
      ? await conversation.external(async (outside) =>
          safeEditMessage(
            outside,
            origin,
            withAntiPhishing(`Phrase saved.\n\n${state.text}`, trimmed),
            { reply_markup: state.reply_markup },
          ),
        )
      : false;
    if (!edited) {
      await ctx.reply(
        withAntiPhishing(`Phrase saved.\n\n${state.text}`, trimmed),
        { reply_markup: state.reply_markup },
      );
    }
    await sweepWorkflow(conversation);
    return;
  }
};

export const registerSettingsCommand = (bot: Bot<AppContext>): void => {
  bot.use(
    createConversation(
      customSlippageConversation as (
        conv: Conversation<AppContext, AppContext>,
        ctx: AppContext,
        ...args: unknown[]
      ) => Promise<void>,
      { id: "settings-custom-slippage", parallel: true },
    ),
  );
  bot.use(
    createConversation(
      buyPresetSlotConversation as (
        conv: Conversation<AppContext, AppContext>,
        ctx: AppContext,
        ...args: unknown[]
      ) => Promise<void>,
      { id: "settings-buy-preset-slot", parallel: true },
    ),
  );
  bot.use(
    createConversation(
      sellPresetSlotConversation as (
        conv: Conversation<AppContext, AppContext>,
        ctx: AppContext,
        ...args: unknown[]
      ) => Promise<void>,
      { id: "settings-sell-preset-slot", parallel: true },
    ),
  );
  bot.use(
    createConversation(
      setPhraseConversation as (
        conv: Conversation<AppContext, AppContext>,
        ctx: AppContext,
        ...args: unknown[]
      ) => Promise<void>,
      { id: "settings-set-phrase", parallel: true },
    ),
  );

  bot.command("settings", async (ctx) => {
    if (!ctx.from) {
      // Channel-post / anonymous-admin updates have no `from`; reply without
      // the anti-phishing wrap because there is no per-user phrase to attach.
      await ctx.reply(noUserReply(ctx));
      return;
    }
    if (!isPrivateChat(ctx)) {
      // Plain reply — wrapping would leak the user's anti-phishing phrase
      // into the group transcript, which is exactly what /security keeps
      // out of non-DM surfaces.
      await ctx.reply(nonPrivateChatReply(ctx));
      return;
    }
    const state = renderMainState(ctx);
    await ctx.reply(wrap(ctx, state.text), {
      reply_markup: state.reply_markup,
    });
  });

  bot.callbackQuery(START_CALLBACK.settings, async (ctx) => {
    if (!ctx.from) {
      await ctx.answerCallbackQuery({ text: t(TOAST_MISSING_USER, getCtxLanguage(ctx)) });
      return;
    }
    if (!(await ensurePrivate(ctx))) return;
    const state = renderMainState(ctx);
    await editToSubmenu(ctx, {
      text: wrap(ctx, state.text),
      inlineKeyboard: state.reply_markup.inline_keyboard,
    });
    await ctx.answerCallbackQuery();
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
        text: t(SETTINGS_SLIPPAGE_SET_REPLY, getCtxLanguage(ctx))(
          formatBpsLabel(clamped),
        ),
      });
    },
  );

  bot.callbackQuery(SETTINGS_CALLBACK.slipCustom, async (ctx) => {
    if (!ctx.from) {
      await ctx.answerCallbackQuery();
      return;
    }
    if (!(await ensurePrivate(ctx))) return;
    const origin = ctx.callbackQuery.message
      ? {
          chatId: ctx.callbackQuery.message.chat.id,
          messageId: ctx.callbackQuery.message.message_id,
        }
      : undefined;
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter("settings-custom-slippage", origin);
  });

  bot.callbackQuery(SETTINGS_CALLBACK.buySettings, async (ctx) => {
    if (!ctx.from) {
      await ctx.answerCallbackQuery();
      return;
    }
    if (!(await ensurePrivate(ctx))) return;
    const parent = snapshotFromCallback(ctx);
    if (parent) pushNavSnapshot(ctx.session, parent);
    await editToState(ctx, renderBuyState(ctx));
    await ctx.answerCallbackQuery();
  });

  // Section-header buttons (`-- Slippage --`, `-- Execution Speed --`)
  // are inert by design — answer the callback so Telegram stops the
  // loading spinner, but leave the panel untouched.
  bot.callbackQuery(SETTINGS_CALLBACK.noop, async (ctx) => {
    await ctx.answerCallbackQuery();
  });

  // Inline execution-speed presets (Lightning / Fast / Eco). Tapping a
  // button promotes that preset to the active tip — values are fixed
  // (see `SPEED_PRESETS`) so there is no edit branch.
  bot.callbackQuery(
    new RegExp(`^${SETTINGS_CALLBACK.speedPreset}\\d+$`),
    async (ctx) => {
      if (!ctx.from) {
        await ctx.answerCallbackQuery();
        return;
      }
      if (!(await ensurePrivate(ctx))) return;
      const idx = decodeSpeedPreset(ctx.callbackQuery.data ?? "");
      if (idx === null || idx < 0 || idx >= SPEED_PRESETS.length) {
        await ctx.answerCallbackQuery();
        return;
      }
      const preset = SPEED_PRESETS[idx]!;
      ctx.session.executionTipGwei = preset.gwei;
      // Drop any obsolete custom-preset payload from older sessions so
      // it can't be silently picked up by a future read path.
      if (ctx.session.executionTipPresetsGwei !== undefined) {
        ctx.session.executionTipPresetsGwei = undefined;
      }
      await editToState(ctx, renderMainState(ctx));
      const lang = getCtxLanguage(ctx);
      await ctx.answerCallbackQuery({
        text: t(SETTINGS_EXECUTION_SPEED_SET_REPLY, lang)(
          t(preset.label, lang),
        ),
      });
    },
  );

  // Language preset row — taps switch `session.language` and re-render
  // the panel so all subsequent labels and toasts come up in the new
  // language immediately.
  bot.callbackQuery(
    new RegExp(`^${SETTINGS_CALLBACK.language}:[A-Za-z]+$`),
    async (ctx) => {
      if (!ctx.from) {
        await ctx.answerCallbackQuery();
        return;
      }
      if (!(await ensurePrivate(ctx))) return;
      const next = decodeLanguagePreset(ctx.callbackQuery.data ?? "");
      if (next === null) {
        await ctx.answerCallbackQuery();
        return;
      }
      const current = ctx.session.language ?? DEFAULT_LANGUAGE;
      if (next === current) {
        await ctx.answerCallbackQuery();
        return;
      }
      ctx.session.language = next;
      // Drop the nav stack — every snapshot on it was rendered in the
      // previous language and Back would otherwise restore stale copy
      // (e.g. the English /start bubble the user came in from). Falling
      // through to Home on the next Back tap re-renders fresh in `next`.
      clearNavStack(ctx.session);
      await editToState(ctx, renderMainState(ctx));
      const toast =
        next === "SimplifiedChinese"
          ? TOAST_LANGUAGE_SET_SIMPLIFIED_CHINESE
          : TOAST_LANGUAGE_SET_ENGLISH;
      await ctx.answerCallbackQuery({ text: t(toast, next) });
    },
  );

  bot.callbackQuery(SETTINGS_CALLBACK.sellSettings, async (ctx) => {
    if (!ctx.from) {
      await ctx.answerCallbackQuery();
      return;
    }
    if (!(await ensurePrivate(ctx))) return;
    const parent = snapshotFromCallback(ctx);
    if (parent) pushNavSnapshot(ctx.session, parent);
    await editToState(ctx, renderSellState(ctx));
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
      // Capture the Buy Settings menu the tap originated from so the
      // wizard can edit it in place when it ends — sending a fresh
      // panel below would leave the stale slot row visible above.
      const origin = ctx.callbackQuery.message
        ? {
            chatId: ctx.callbackQuery.message.chat.id,
            messageId: ctx.callbackQuery.message.message_id,
          }
        : undefined;
      await ctx.answerCallbackQuery();
      await ctx.conversation.enter("settings-buy-preset-slot", idx, origin);
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
      const origin = ctx.callbackQuery.message
        ? {
            chatId: ctx.callbackQuery.message.chat.id,
            messageId: ctx.callbackQuery.message.message_id,
          }
        : undefined;
      await ctx.answerCallbackQuery();
      await ctx.conversation.enter("settings-sell-preset-slot", idx, origin);
    },
  );

  bot.callbackQuery(SETTINGS_CALLBACK.phraseSet, async (ctx) => {
    if (!ctx.from) {
      await ctx.answerCallbackQuery();
      return;
    }
    if (!(await ensurePrivate(ctx))) return;
    const origin = ctx.callbackQuery.message
      ? {
          chatId: ctx.callbackQuery.message.chat.id,
          messageId: ctx.callbackQuery.message.message_id,
        }
      : undefined;
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter("settings-set-phrase", origin);
  });

  bot.callbackQuery(SETTINGS_CALLBACK.phraseClear, async (ctx) => {
    if (!ctx.from) {
      await ctx.answerCallbackQuery();
      return;
    }
    if (!(await ensurePrivate(ctx))) return;
    ctx.session.antiPhishingPhrase = undefined;
    await editToState(ctx, renderMainState(ctx));
    await ctx.answerCallbackQuery({
      text: t(TOAST_PHRASE_CLEARED, getCtxLanguage(ctx)),
    });
  });

  bot.callbackQuery(SETTINGS_CALLBACK.degenToggle, async (ctx) => {
    if (!ctx.from) {
      await ctx.answerCallbackQuery();
      return;
    }
    if (!(await ensurePrivate(ctx))) return;
    const next = !ctx.session.degenMode;
    ctx.session.degenMode = next;
    await editToState(ctx, renderMainState(ctx));
    const lang = getCtxLanguage(ctx);
    await ctx.answerCallbackQuery({
      text: next
        ? t(TOAST_DEGEN_MODE_ENABLED, lang)
        : t(TOAST_DEGEN_MODE_DISABLED, lang),
    });
  });
};
