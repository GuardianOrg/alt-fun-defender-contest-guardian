import {
  type Conversation,
  createConversation,
} from "@grammyjs/conversations";
import type { Bot } from "grammy";

import type { AppContext } from "../bot.js";
import {
  WALLET_CALLBACK,
  buildWalletMainKeyboard,
  buildWalletSwitchKeyboard,
} from "../keyboards/wallet-actions.js";
import { withAntiPhishing } from "../lib/anti-phishing.js";
import {
  MAX_WALLETS_PER_USER,
  TooManyWalletsError,
  WalletManager,
  WalletNotFoundError,
  type StoredWallet,
} from "../lib/wallet.js";

const NO_USER_REPLY =
  "Wallets require a personal Telegram account — this message has no user attached (channel post or anonymous admin).";

const NON_PRIVATE_CHAT_REPLY =
  "Wallet flows are private-DM only — wallet labels and addresses must not surface in groups. Open a direct chat with the bot to manage wallets.";

const RENAME_MAX_LEN = 32;

const isPrivateChat = (ctx: AppContext): boolean =>
  ctx.chat?.type === "private";

/**
 * Defense-in-depth: every wallet callback handler funnels through this
 * before reading or mutating KV. The `/wallet` command itself is also
 * private-only, so in practice inline buttons should only ever exist
 * in private chats — but a forwarded message or future code path
 * could still surface a button in a group. Silent toast + return is
 * safer than answering with wallet state.
 */
const ensurePrivate = async (ctx: AppContext): Promise<boolean> => {
  if (isPrivateChat(ctx)) return true;
  await ctx.answerCallbackQuery({
    text: "Wallet actions are private-DM only.",
    show_alert: true,
  });
  return false;
};

const truncateAddress = (addr: string): string =>
  `${addr.slice(0, 6)}…${addr.slice(-4)}`;

const renderMainText = (
  wallets: StoredWallet[],
  active: StoredWallet | null,
): string => {
  if (wallets.length === 0) {
    // "Import from Web App" called out as a first-class path because
    // it's the #1 source of user confusion per AGENTS.md "Key
    // Constraints" — users who already have a Privy wallet on the web
    // app need an unambiguous bridge, not a parenthetical mention.
    return [
      "No wallets yet.",
      "",
      "• Create — generate a new bot-managed wallet to start trading",
      "• Import from Web App — paste your Privy private key exported from alt.fun",
      "• Import — paste any other private key or mnemonic",
    ].join("\n");
  }
  const lines = [`Wallets (${wallets.length}/${MAX_WALLETS_PER_USER})`, ""];
  for (const w of wallets) {
    const marker = w.id === active?.id ? "*" : " ";
    lines.push(
      `${marker} ${w.label ?? "(unlabeled)"} — ${truncateAddress(w.address)}`,
    );
  }
  if (active) {
    lines.push("", "* = active wallet (used for buy / sell / withdraw)");
  }
  return lines.join("\n");
};

const buildManager = (env: AppContext["env"]): WalletManager =>
  new WalletManager(env.WALLET_KV, env.MASTER_KEY);

const renderMainState = async (
  wm: WalletManager,
  userId: number,
): Promise<{
  text: string;
  reply_markup: {
    inline_keyboard: ReturnType<typeof buildWalletMainKeyboard>;
  };
}> => {
  const wallets = await wm.listWallets(userId);
  const active = await wm.getActive(userId);
  return {
    text: renderMainText(wallets, active),
    reply_markup: {
      inline_keyboard: buildWalletMainKeyboard(
        wallets.length > 0,
        active !== null,
      ),
    },
  };
};

const editToMain = async (ctx: AppContext): Promise<void> => {
  if (!ctx.from || !ctx.callbackQuery?.message) return;
  const wm = buildManager(ctx.env);
  const state = await renderMainState(wm, ctx.from.id);
  await ctx.editMessageText(withAntiPhishing(state.text), {
    reply_markup: state.reply_markup,
  });
};

/**
 * Rename conversation: bot prompts for the new label, user replies
 * with text, we validate + apply + edit the wallet card back to the
 * main view. The conversation pattern is the canonical use case the
 * grammY plugin is built for — single wait point, no side-effected
 * replay surface.
 *
 * `conversation.waitFor("message:text")` blocks until the user sends a
 * plain text message in this chat. The replay engine re-runs the
 * function body up to this point on every incoming update; everything
 * before the wait must be idempotent. We pass `walletId` in as an arg
 * rather than reading it from KV inside the conversation, so the
 * replay doesn't re-fetch.
 */
const renameWalletConversation = async (
  conversation: Conversation<AppContext, AppContext>,
  ctx: AppContext,
  walletId: string,
): Promise<void> => {
  await ctx.reply(
    withAntiPhishing("Send the new label for this wallet (max 32 chars)."),
  );
  const reply = await conversation.waitFor("message:text");
  const label = reply.message.text.trim();
  if (label === "" || label.length > RENAME_MAX_LEN) {
    await reply.reply(
      withAntiPhishing(
        `Label must be 1–${RENAME_MAX_LEN} characters. Rename cancelled.`,
      ),
    );
    return;
  }
  if (!reply.from) return;
  const wm = await conversation.external(() => buildManager(ctx.env));
  try {
    await conversation.external(() =>
      wm.renameWallet(reply.from!.id, walletId, label),
    );
  } catch (err) {
    if (err instanceof WalletNotFoundError) {
      await reply.reply(
        withAntiPhishing("Wallet no longer exists. Rename cancelled."),
      );
      return;
    }
    throw err;
  }
  const state = await conversation.external(() =>
    renderMainState(wm, reply.from!.id),
  );
  await reply.reply(withAntiPhishing(state.text), {
    reply_markup: state.reply_markup,
  });
};

export const registerWalletCommand = (bot: Bot<AppContext>): void => {
  // Conversation registration — must come before any handler that
  // calls `ctx.conversation.enter("...")`. The name is the public
  // identifier passed to `enter` from callback handlers below.
  bot.use(
    createConversation(renameWalletConversation, "wallet-rename"),
  );

  /**
   * `/wallet` entry point. Sends the main view with the action
   * keyboard. Messages without a `from` (channel posts, anonymous
   * admins) get a clear "wallets require a personal account" reply
   * rather than dispatching into the manager with an unknown userId.
   */
  bot.command("wallet", async (ctx) => {
    if (!ctx.from) {
      await ctx.reply(withAntiPhishing(NO_USER_REPLY));
      return;
    }
    // Wallet flows are private-only — group / supergroup / channel
    // contexts would publicly leak wallet labels and addresses, and
    // callback flows would let any group member mutate state. Reject
    // anything that isn't a 1:1 chat before doing any KV reads.
    if (!isPrivateChat(ctx)) {
      await ctx.reply(withAntiPhishing(NON_PRIVATE_CHAT_REPLY));
      return;
    }
    const wm = buildManager(ctx.env);
    const state = await renderMainState(wm, ctx.from.id);
    await ctx.reply(withAntiPhishing(state.text), {
      reply_markup: state.reply_markup,
    });
  });

  bot.callbackQuery(WALLET_CALLBACK.create, async (ctx) => {
    if (!ctx.from) {
      await ctx.answerCallbackQuery({ text: "Missing user." });
      return;
    }
    if (!(await ensurePrivate(ctx))) return;
    const wm = buildManager(ctx.env);
    try {
      const wallet = await wm.createWallet(ctx.from.id);
      await editToMain(ctx);
      await ctx.answerCallbackQuery({
        text: `Created ${truncateAddress(wallet.address)}`,
      });
    } catch (err) {
      if (err instanceof TooManyWalletsError) {
        await ctx.answerCallbackQuery({
          text: `Wallet cap reached (${MAX_WALLETS_PER_USER}). Delete one first.`,
          show_alert: true,
        });
        return;
      }
      throw err;
    }
  });

  bot.callbackQuery(WALLET_CALLBACK.switchPicker, async (ctx) => {
    if (!ctx.from || !ctx.callbackQuery.message) {
      await ctx.answerCallbackQuery();
      return;
    }
    if (!(await ensurePrivate(ctx))) return;
    const wm = buildManager(ctx.env);
    const wallets = await wm.listWallets(ctx.from.id);
    if (wallets.length === 0) {
      await ctx.answerCallbackQuery({
        text: "No wallets to switch to.",
        show_alert: true,
      });
      return;
    }
    const active = await wm.getActive(ctx.from.id);
    await ctx.editMessageText(
      withAntiPhishing("Pick the wallet to use as active:"),
      {
        reply_markup: {
          inline_keyboard: buildWalletSwitchKeyboard(
            wallets,
            active?.id ?? null,
          ),
        },
      },
    );
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(
    new RegExp(`^${WALLET_CALLBACK.switchTo}:`),
    async (ctx) => {
      if (!ctx.from) {
        await ctx.answerCallbackQuery();
        return;
      }
      if (!(await ensurePrivate(ctx))) return;
      const data = ctx.callbackQuery.data ?? "";
      const walletId = data.split(":")[1];
      if (!walletId) {
        await ctx.answerCallbackQuery({ text: "Invalid switch target." });
        return;
      }
      const wm = buildManager(ctx.env);
      try {
        await wm.setActive(ctx.from.id, walletId);
      } catch (err) {
        if (err instanceof WalletNotFoundError) {
          await ctx.answerCallbackQuery({
            text: "Wallet no longer exists.",
            show_alert: true,
          });
          return;
        }
        throw err;
      }
      const wallet = await wm.getWallet(ctx.from.id, walletId);
      await editToMain(ctx);
      await ctx.answerCallbackQuery({
        text: wallet?.label ? `Switched to ${wallet.label}` : "Switched.",
      });
    },
  );

  bot.callbackQuery(WALLET_CALLBACK.mainBack, async (ctx) => {
    if (!(await ensurePrivate(ctx))) return;
    await editToMain(ctx);
    await ctx.answerCallbackQuery();
  });

  /**
   * Rename picker stub: in v1 we enter the conversation for the active
   * wallet. A multi-wallet picker (rename any wallet, not just active)
   * lands once the conversation flow is proven out — keeping the
   * surface small for the first conversations integration.
   */
  bot.callbackQuery(WALLET_CALLBACK.rename, async (ctx) => {
    if (!ctx.from) {
      await ctx.answerCallbackQuery();
      return;
    }
    if (!(await ensurePrivate(ctx))) return;
    const wm = buildManager(ctx.env);
    const active = await wm.getActive(ctx.from.id);
    if (!active) {
      await ctx.answerCallbackQuery({
        text: "No active wallet to rename.",
        show_alert: true,
      });
      return;
    }
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter("wallet-rename", active.id);
  });

  // Stubs for actions still gated on missing infra. Surface a toast
  // alert rather than silently no-op'ing so users see a clear "not
  // yet". Callback codes reserved here so future PRs only swap the
  // handler body.
  const stubScene = async (ctx: AppContext): Promise<void> => {
    await ctx.answerCallbackQuery({
      text: "Coming soon — needs the multi-step wizard infra.",
      show_alert: true,
    });
  };
  const stubPin = async (ctx: AppContext): Promise<void> => {
    await ctx.answerCallbackQuery({
      text: "Coming soon — needs the PIN flow.",
      show_alert: true,
    });
  };

  bot.callbackQuery(WALLET_CALLBACK.import, stubScene);
  bot.callbackQuery(WALLET_CALLBACK.delete, stubPin);
  bot.callbackQuery(WALLET_CALLBACK.exportKey, stubPin);
  bot.callbackQuery(WALLET_CALLBACK.withdraw, stubPin);
};
