import { KvAdapter } from "@grammyjs/storage-cloudflare";
import {
  type ConversationData,
  type ConversationFlavor,
  type VersionedState,
  conversations,
} from "@grammyjs/conversations";
import { Bot, type Context, session, type SessionFlavor } from "grammy";

import { logger } from "./lib/logger.js";
import { registerBuyCommand } from "./commands/buy.js";
import { registerHelpCommand } from "./commands/help.js";
import { registerPositionsCommand } from "./commands/positions.js";
import { registerReferralCommand } from "./commands/referral.js";
import { registerSecurityCommand } from "./commands/security.js";
import { registerSellCommand } from "./commands/sell.js";
import { registerStartCommand } from "./commands/start.js";
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
}

const DEFAULT_SESSION: SessionData = {
  slippageBps: 100,
  defaultBuyUsdc: 50,
  degenMode: false,
};

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
      initial: () => ({ ...DEFAULT_SESSION }),
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

  registerHelpCommand(bot);
  registerStartCommand(bot);
  registerBuyCommand(bot);
  registerSellCommand(bot);
  registerPositionsCommand(bot);
  registerReferralCommand(bot);
  registerSecurityCommand(bot);
  registerWalletCommand(bot);
  registerWithdrawCommand(bot);

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
