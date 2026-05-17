import type { Bot } from "grammy";

import type { AppContext } from "../bot.js";
import { START_CALLBACK } from "../keyboards/start-menu.js";
import {
  ctxAntiPhishingPhrase,
  resolveAntiPhishingHeader,
} from "../lib/anti-phishing.js";
import {
  HELP_FEES_HTML,
  HELP_HEADER_PLACEHOLDER_TOKEN,
  HELP_OVERVIEW_HTML,
  HELP_PNL_HTML,
  HELP_REFERRALS_HTML,
  HELP_SECURITY_HTML,
  HELP_TRADING_HTML,
  HELP_UNKNOWN_TOPIC_HTML,
  HELP_WALLET_HTML,
  HELP_WITHDRAW_HTML,
} from "../lib/i18n.js";
import { backHomeRow, editToSubmenu } from "../lib/nav.js";

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * Topic keys accepted as `/help <topic>`. The default (no arg)
 * renders the overview. Aliases collapse common synonyms onto a
 * single canonical key so users don't need to memorise the exact
 * topic name (`/help trade` and `/help buy` both land on trading).
 */
const TOPIC_ALIASES: Record<string, string> = {
  wallet: "wallet",
  wallets: "wallet",
  buy: "trading",
  sell: "trading",
  trade: "trading",
  trading: "trading",
  fee: "fees",
  fees: "fees",
  pnl: "pnl",
  profit: "pnl",
  security: "security",
  pin: "security",
  sap: "security",
  phrase: "security",
  lock: "security",
  referral: "referrals",
  referrals: "referrals",
  withdraw: "withdraw",
  withdrawal: "withdraw",
};

const TOPIC_LIST = [
  "wallet",
  "trading",
  "fees",
  "pnl",
  "security",
  "referrals",
  "withdraw",
];

const TOPIC_HTML: Record<string, string> = {
  wallet: HELP_WALLET_HTML.English,
  trading: HELP_TRADING_HTML.English,
  fees: HELP_FEES_HTML.English,
  pnl: HELP_PNL_HTML.English,
  security: HELP_SECURITY_HTML.English,
  referrals: HELP_REFERRALS_HTML.English,
  withdraw: HELP_WITHDRAW_HTML.English,
};

/**
 * Resolve `/help <topic>` argument text into a rendered HTML body.
 * Returns the overview when `arg` is empty, the topic body when the
 * (case-insensitive) alias matches, and the unknown-topic hint
 * otherwise. Keeping resolution pure makes the handler trivial to
 * exercise from tests without spinning up grammY.
 */
export const renderHelp = (
  arg: string | undefined,
  phrase: string | null | undefined,
): string => {
  const raw = arg?.trim().toLowerCase();
  const template = !raw
    ? HELP_OVERVIEW_HTML.English(TOPIC_LIST)
    : TOPIC_HTML[TOPIC_ALIASES[raw] ?? ""] ??
      HELP_UNKNOWN_TOPIC_HTML.English(TOPIC_LIST);
  return template.replace(
    HELP_HEADER_PLACEHOLDER_TOKEN,
    escapeHtml(resolveAntiPhishingHeader(phrase)),
  );
};

const sendHelp = async (
  ctx: AppContext,
  arg: string | undefined,
): Promise<void> => {
  await ctx.reply(renderHelp(arg, ctxAntiPhishingPhrase(ctx)), {
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  });
};

const showHelpFromCallback = async (ctx: AppContext): Promise<void> => {
  await editToSubmenu(ctx, {
    text: renderHelp(undefined, ctxAntiPhishingPhrase(ctx)),
    parseMode: "HTML",
    inlineKeyboard: [backHomeRow()],
    linkPreviewDisabled: true,
  });
};

export const registerHelpCommand = (bot: Bot<AppContext>): void => {
  bot.command("help", async (ctx) => {
    await sendHelp(ctx, ctx.match);
  });

  bot.callbackQuery(START_CALLBACK.help, async (ctx) => {
    await showHelpFromCallback(ctx);
    await ctx.answerCallbackQuery();
  });
};
