import { KvAdapter } from "@grammyjs/storage-cloudflare";
import {
  type ConversationData,
  type ConversationFlavor,
  type VersionedState,
  conversations,
} from "@grammyjs/conversations";
import { Bot, type Context, session, type SessionFlavor } from "grammy";

import { registerAddressBuyIntercept } from "./lib/buy-card.js";
import { logger } from "./lib/logger.js";
import { registerNavCallbacks } from "./lib/nav.js";
import { registerBuyCommand } from "./commands/buy.js";
import { registerHelpCommand } from "./commands/help.js";
import { registerPositionsCommand } from "./commands/positions.js";
import { registerReferralCommand } from "./commands/referral.js";
import { registerSecurityCommand } from "./commands/security.js";
import { registerSellCommand } from "./commands/sell.js";
import { registerSettingsCommand } from "./commands/settings.js";
import { buildStartSnapshot, registerStartCommand } from "./commands/start.js";
import { registerTrackCommand } from "./commands/track.js";
import { registerWalletCommand } from "./commands/wallet.js";
import { registerWithdrawCommand } from "./commands/withdraw.js";
import type { Env } from "./lib/types.js";

/**
 * Per-user persistent settings written via `/settings` and `/security`.
 * Lives in `WALLET_KV` alongside wallet records (different key prefix);
 * grammY's session plugin handles read-on-update + write-on-reply.
 *
 * v1 holds only what's actually consumed by other commands. Add fields
 * as the corresponding settings UI lands — never read a session field
 * the user has never had a chance to set.
 */
export interface SessionData {
  slippageBps: number;
  defaultBuyUsdc: number;
  /**
   * 5-slot customizable buy preset amounts in USDC (issue #818). Older
   * sessions written before this field landed have it undefined; the
   * `normaliseBuyPresets` helper in `keyboards/buy-sell-token.ts` lifts
   * the legacy `defaultBuyUsdc` into slot 0 and fills the rest with
   * defaults.
   */
  buyPresetsUsdc?: number[];
  /**
   * 5-slot customizable sell preset percentages (issue #818). Older
   * sessions have it undefined; `normaliseSellPresets` falls back to
   * the default `[10, 25, 50, 75, 100]`.
   */
  sellPresetsPct?: number[];
  antiPhishingPhrase?: string;
  degenMode: boolean;
  /**
   * One-shot trade intent staged by a quick-amount button and committed
   * by the matching Confirm callback. Per-user single slot — the next
   * Buy/Sell button click overwrites it, which is the right UX (latest
   * intent wins, the previous Confirm becomes a stale-nonce no-op).
   * Stored as raw strings to round-trip through grammY's JSON session
   * storage (bigint is not JSON-serialisable).
   */
  pendingTrade?: {
    side: "buy" | "sell";
    token: string;
    /** USDC raw (6dp) for buy notional, token raw (18dp) for sell amount. */
    amountRaw: string;
    ticker: string;
    nonce: string;
    expiresAt: number;
  };
  /**
   * One-shot withdraw intent staged after PIN verification and committed
   * by the matching [Confirm Withdraw] callback. Same per-user single
   * slot semantics as `pendingTrade` — re-running `/withdraw` overwrites
   * the previous slot and the prior Confirm becomes a stale-nonce no-op.
   * The 60-second `expiresAt` is the AGENTS.md `/withdraw` "confirm
   * timeout 60s" guarantee.
   */
  pendingWithdraw?: {
    asset: "HYPE" | "USDC";
    to: string;
    /** Raw amount in the asset's decimals (18dp HYPE, 6dp USDC). */
    amountRaw: string;
    nonce: string;
    expiresAt: number;
  };
  /**
   * Workflow-stack of transient (chatId, messageId) pairs generated
   * during a multi-step prompt flow (e.g. /buy lookup → user reply →
   * custom amount → user reply). Per-chat scoped so a sweep in chat A
   * doesn't touch ids belonging to chat B — the session is keyed per
   * user, but a single user can run flows in both a private DM and a
   * group. Cleared on cancel, on interruption by another slash
   * command, and on successful completion. See `lib/workflow-stack.ts`.
   */
  workflowMessages?: { chatId: number; messageId: number }[];
  /**
   * Last buy-card (or buy-card error fallback) shipped by the address
   * intercept — bare-text paste (`registerAddressBuyIntercept`) or a
   * wizard pivot (`tryAddressBuyIntercept`). Before shipping a new card
   * the helper deletes this one, so a second paste replaces the first
   * card in place instead of stacking a new card above the stale one
   * (issue: "old prompt doesn't disappear"). Keyed by `chatId` (as a
   * string for JSON round-trip) so a user who alternates between two
   * chats still has each chat's last card tracked independently.
   */
  lastBuyCardMessageByChat?: Record<string, number>;
  /**
   * Navigation stack of message snapshots used to power the global
   * `[← Back]` / `[🏠 Home]` row that lives on every system prompt
   * except `/start`. Each entry captures the text + inline keyboard
   * the user was last looking at; tapping Back pops one and edits the
   * current message back to that state. See `lib/nav.ts`.
   */
  navStack?: import("./lib/nav.js").NavSnapshot[];
}

/**
 * Default preset values, deep-cloned on every `initial()` call so two
 * fresh sessions can never share an inner array reference. The session
 * plugin's shallow `{...DEFAULT_SESSION}` spread would otherwise let an
 * in-place mutation in one chat's handler bleed across every other
 * session served by this Worker isolate (CodeRabbit PR #829).
 */
const DEFAULT_BUY_PRESETS = [20, 40, 60, 80, 100] as const;
const DEFAULT_SELL_PRESETS = [10, 25, 50, 75, 100] as const;

const buildDefaultSession = (): SessionData => ({
  slippageBps: 1000,
  defaultBuyUsdc: 20,
  buyPresetsUsdc: [...DEFAULT_BUY_PRESETS],
  sellPresetsPct: [...DEFAULT_SELL_PRESETS],
  degenMode: true,
});

/**
 * Composite context type for the bot.
 *   - `ConversationFlavor` adds `ctx.conversation.enter("name")` etc.
 *   - `SessionFlavor<SessionData>` adds `ctx.session` typed as above.
 *   - `env` is added by the first middleware so handlers can hit KV /
 *     viem / secrets without threading the binding through every call.
 */
export type AppContext = ConversationFlavor<
  Context & SessionFlavor<SessionData>
> & {
  env: Env;
};

/**
 * Build a fresh grammY Bot for one request. The Workers pattern is
 * stateless: every webhook invocation (or DO turn) instantiates a Bot,
 * runs `handleUpdate(update)`, and discards it. No long-running process
 * holds Bot state — that's why session storage MUST be KV-backed.
 *
 * Concurrency: this Bot instance is single-use, but multiple requests
 * for the SAME chat can hit different Worker isolates and race on
 * session reads/writes. The `ChatDO` wrapper serializes updates per
 * chat to close that race — see `chat-do.ts`.
 */
export interface CreateBotOptions {
  /**
   * Override the fetch grammY uses for Telegram API calls. Production
   * leaves this unset (grammY's Node shim picks `node-fetch` which is
   * fine on Cloudflare Workers via `nodejs_compat`). Tests inject a
   * spied `globalThis.fetch` so they can observe outbound calls
   * without monkey-patching `node-fetch` directly.
   */
  fetch?: typeof fetch;
}

export const createBot = (
  env: Env,
  options: CreateBotOptions = {},
): Bot<AppContext> => {
  if (!env.API_KEY) {
    // Surface the degraded mode loudly so it doesn't get silently
    // shipped to real users. Fix tracked in #640. AGENTS.md "Auth
    // model" is the eventual contract; this branch is a deliberate
    // smoke-test escape hatch.
    logger.warn(
      "API_KEY not set — apps/api calls fall into the anonymous 240/min per-IP bucket, shared across all users on this Worker. Provision before any real concurrency. See issue #640.",
    );
  }

  const bot = new Bot<AppContext>(env.TELEGRAM_BOT_TOKEN, {
    client: options.fetch
      ? { fetch: options.fetch as never }
      : undefined,
    // Skip Bot.init() — webhook mode never calls Telegram's `getMe`,
    // and skipping the call saves a round-trip on every cold start.
    // Cast through unknown so the botInfo stub stays minimal: we don't
    // depend on any of these fields downstream, and grammY only reads
    // `id` / `username` to detect mentions in group chats.
    botInfo: {
      id: 0,
      is_bot: true,
      first_name: "alt-fun-bot",
      username: "alt-fun-bot",
      can_join_groups: true,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
    } as unknown as Bot<AppContext>["botInfo"],
  });

  bot.use(async (ctx, next) => {
    ctx.env = env;
    await next();
  });

  bot.use(
    session<SessionData, AppContext>({
      initial: () => buildDefaultSession(),
      // KvAdapter's `KVNamespace` type comes from its own pinned
      // `@cloudflare/workers-types` version, which can drift from ours.
      // Cast through unknown — the runtime surface (get/put/delete) is
      // stable across types versions.
      storage: new KvAdapter<SessionData>(
        env.WALLET_KV as unknown as ConstructorParameters<
          typeof KvAdapter
        >[0],
      ),
      // Key by user, not chat — every wallet/setting is user-owned
      // regardless of where the user invokes the bot from.
      getSessionKey: (ctx) =>
        ctx.from === undefined ? undefined : `session:${ctx.from.id}`,
    }),
  );

  // Conversations plugin defaults to in-memory storage. Workers are
  // stateless per request, so without a persistent adapter the active-
  // conversation record is dropped between the `enter` call and the
  // user's follow-up message — leaving the next update unmatched and
  // silent. Back it with the same KV namespace that holds sessions
  // under a `conv:` prefix so it never collides with `session:*`.
  bot.use(
    conversations<AppContext, AppContext>({
      storage: {
        type: "key",
        version: 0,
        prefix: "conv:",
        adapter: new KvAdapter<VersionedState<ConversationData>>(
          env.WALLET_KV as unknown as ConstructorParameters<
            typeof KvAdapter
          >[0],
        ),
      },
    }),
  );

  registerNavCallbacks(bot, async (ctx) => buildStartSnapshot(ctx));
  registerHelpCommand(bot);
  registerStartCommand(bot);
  registerBuyCommand(bot);
  registerSellCommand(bot);
  registerPositionsCommand(bot);
  registerReferralCommand(bot);
  registerSecurityCommand(bot);
  registerSettingsCommand(bot);
  registerTrackCommand(bot);
  registerWalletCommand(bot);
  registerWithdrawCommand(bot);

  // Tail of the middleware chain — conversations plugin and command
  // handlers run first, so this only fires for plain text outside any
  // other matched flow. See `registerAddressBuyIntercept`.
  registerAddressBuyIntercept(bot);

  bot.catch((err) => {
    // Logged + swallowed so a bug in any handler can't propagate
    // out of `bot.handleUpdate` and crash the DO fetch. The webhook
    // route depends on the DO returning 200 to keep Telegram from
    // retry-storming us. ChatDO logs again at its boundary as a
    // belt-and-suspenders check.
    logger.error("grammY middleware failed", {
      cmd: err.ctx.update.message?.text ?? err.ctx.update.callback_query?.data,
      err: err.error,
    });
  });

  return bot;
};
