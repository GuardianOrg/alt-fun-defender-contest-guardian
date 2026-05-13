import { MIN_USDC_BUY_AMOUNT } from "@launchpad/shared";
import {
  type Conversation,
  createConversation,
} from "@grammyjs/conversations";
import type { Bot } from "grammy";

import type { AppContext } from "../bot.js";
import { START_CALLBACK } from "../keyboards/start-menu.js";
import {
  SETTINGS_CALLBACK,
  SLIPPAGE_PRESETS_BPS,
  buildSettingsKeyboard,
  decodeSlippagePreset,
  formatBpsLabel,
  type SettingsStatus,
} from "../keyboards/settings-actions.js";
import { wrapWithCtxPhrase as wrap } from "../lib/anti-phishing.js";

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

/**
 * Upper bound on the persisted default buy amount. Mirrors the `$10_000`
 * cap surfaced for the /buy custom-amount wizard so a stored default
 * can't sneak past balance-sanity checks elsewhere.
 */
const MAX_BUY_USDC = 10_000;

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

const renderStatusText = (status: SettingsStatus): string =>
  [
    "Settings",
    "",
    `• Slippage: ${formatBpsLabel(status.slippageBps)}`,
    `• Default buy: $${status.defaultBuyUsdc} USDC`,
    `• Degen mode: ${status.degenMode ? "on" : "off"}`,
    "",
    "Anti-phishing phrase lives in /security.",
  ].join("\n");

interface RenderedState {
  text: string;
  reply_markup: {
    inline_keyboard: ReturnType<typeof buildSettingsKeyboard>;
  };
}

const renderState = (ctx: AppContext): RenderedState => {
  const status = readStatus(ctx);
  return {
    text: renderStatusText(status),
    reply_markup: { inline_keyboard: buildSettingsKeyboard(status) },
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

const editToMain = async (ctx: AppContext): Promise<void> => {
  const state = renderState(ctx);
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
  const presetList = SLIPPAGE_PRESETS_BPS.map((bps) =>
    formatBpsLabel(bps),
  ).join(" / ");
  await ctx.reply(
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

  while (true) {
    const msg = await conversation.waitFor("message:text");
    const text = msg.message.text.trim();
    if (isCancel(text)) {
      await ctx.reply(wrap(ctx, "Cancelled."));
      return;
    }
    const pct = Number(text.replace(/%/g, "").trim());
    if (!Number.isFinite(pct) || pct <= 0) {
      await ctx.reply(
        wrap(ctx, "Send a positive number like `2` or `0.5`, or /cancel."),
      );
      continue;
    }
    const bps = Math.round(pct * 100);
    if (bps < 1) {
      await ctx.reply(
        wrap(ctx, "Slippage must be at least 0.01%. Send again or /cancel."),
      );
      continue;
    }
    if (bps > MAX_SLIPPAGE_BPS) {
      await ctx.reply(
        wrap(
          ctx,
          `Slippage capped at ${MAX_SLIPPAGE_BPS / 100}% — send a smaller value or /cancel.`,
        ),
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
      await ctx.reply(wrap(ctx, "Failed to save — please retry."));
      return;
    }
    const state = await conversation.external((outside) => renderState(outside));
    await ctx.reply(
      wrap(ctx, `Slippage set to ${formatBpsLabel(bps)}.\n\n${state.text}`),
      { reply_markup: state.reply_markup },
    );
    return;
  }
};

/**
 * Conversation: collect a new default buy amount (USDC). Floored at
 * `MIN_USDC_BUY_AMOUNT` so a stored default can't fall below the bot's
 * minimum-trade gate (which would just immediately reject the trade).
 */
const buyAmountConversation = async (
  conversation: Conversation<AppContext, AppContext>,
  ctx: AppContext,
): Promise<void> => {
  await ctx.reply(
    wrap(
      ctx,
      [
        `Send your default buy amount in USDC (minimum $${MIN_USDC_BUY_AMOUNT}, max $${MAX_BUY_USDC}).`,
        "",
        "Send /cancel to keep the current value.",
      ].join("\n"),
    ),
  );

  while (true) {
    const msg = await conversation.waitFor("message:text");
    const text = msg.message.text.trim();
    if (isCancel(text)) {
      await ctx.reply(wrap(ctx, "Cancelled."));
      return;
    }
    const value = Number(text.replace(/[$,]/g, "").trim());
    if (!Number.isFinite(value) || value <= 0) {
      await ctx.reply(
        wrap(ctx, "Send a positive USDC amount like `50`, or /cancel."),
      );
      continue;
    }
    if (value < MIN_USDC_BUY_AMOUNT) {
      await ctx.reply(
        wrap(
          ctx,
          `Minimum is $${MIN_USDC_BUY_AMOUNT} USDC. Send a larger value or /cancel.`,
        ),
      );
      continue;
    }
    if (value > MAX_BUY_USDC) {
      await ctx.reply(
        wrap(
          ctx,
          `Capped at $${MAX_BUY_USDC} USDC. Send a smaller value or /cancel.`,
        ),
      );
      continue;
    }
    // Round to whole USDC — the value is shown on buttons and stored
    // for use as a /buy prefill; sub-dollar precision is noise.
    const rounded = Math.round(value);
    try {
      await conversation.external((outside) => {
        outside.session.defaultBuyUsdc = rounded;
      });
    } catch {
      await ctx.reply(wrap(ctx, "Failed to save — please retry."));
      return;
    }
    const state = await conversation.external((outside) => renderState(outside));
    await ctx.reply(
      wrap(ctx, `Default buy set to $${rounded} USDC.\n\n${state.text}`),
      { reply_markup: state.reply_markup },
    );
    return;
  }
};

export const registerSettingsCommand = (bot: Bot<AppContext>): void => {
  bot.use(
    createConversation(customSlippageConversation, "settings-custom-slippage"),
  );
  bot.use(createConversation(buyAmountConversation, "settings-buy-amount"));

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
    const state = renderState(ctx);
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
    const state = renderState(ctx);
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
      await editToMain(ctx);
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

  bot.callbackQuery(SETTINGS_CALLBACK.buyAmount, async (ctx) => {
    if (!ctx.from) {
      await ctx.answerCallbackQuery();
      return;
    }
    if (!(await ensurePrivate(ctx))) return;
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter("settings-buy-amount");
  });

  bot.callbackQuery(SETTINGS_CALLBACK.degenToggle, async (ctx) => {
    if (!ctx.from) {
      await ctx.answerCallbackQuery();
      return;
    }
    if (!(await ensurePrivate(ctx))) return;
    const next = !ctx.session.degenMode;
    ctx.session.degenMode = next;
    await editToMain(ctx);
    await ctx.answerCallbackQuery({
      text: next ? "Degen mode enabled." : "Degen mode disabled.",
    });
  });
};
