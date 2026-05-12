import { callbackHandlers, type CallbackHandler } from "../lib/callbacks.js";
import {
  WALLET_CALLBACK,
  buildWalletMainKeyboard,
  buildWalletSwitchKeyboard,
} from "../keyboards/wallet-actions.js";
import { editMessageText, sendMessage } from "../lib/telegram.js";
import {
  MAX_WALLETS_PER_USER,
  TooManyWalletsError,
  WalletManager,
  WalletNotFoundError,
  type StoredWallet,
} from "../lib/wallet.js";
import type { Env } from "../lib/types.js";
import type { TelegramCallbackQuery } from "../lib/telegram.js";

const NO_USER_REPLY =
  "Wallets require a personal Telegram account — this message has no user attached (channel post or anonymous admin).";

const truncateAddress = (addr: string): string =>
  `${addr.slice(0, 6)}…${addr.slice(-4)}`;

const renderMainText = (
  wallets: StoredWallet[],
  active: StoredWallet | null,
): string => {
  if (wallets.length === 0) {
    return [
      "No wallets yet.",
      "",
      "Create one to start trading, or import a private key from the web app's Privy export.",
    ].join("\n");
  }
  const lines = [
    `Wallets (${wallets.length}/${MAX_WALLETS_PER_USER})`,
    "",
  ];
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

const buildManager = (env: Env): WalletManager =>
  new WalletManager(env.WALLET_KV, env.MASTER_KEY);

const renderMainState = async (
  wm: WalletManager,
  userId: number,
): Promise<{
  text: string;
  reply_markup: { inline_keyboard: ReturnType<typeof buildWalletMainKeyboard> };
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

/**
 * `/wallet` entry point. Sends the main view with the action keyboard.
 * The `userId` is `msg.from?.id` from the dispatcher — undefined for
 * channel posts and anonymous group admins, which cannot have a
 * custodial wallet because there's no stable identity to key KV on.
 */
export const handleWallet = async (
  env: Env,
  chatId: number,
  userId: number | undefined,
): Promise<void> => {
  if (userId === undefined) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, NO_USER_REPLY);
    return;
  }
  const wm = buildManager(env);
  const state = await renderMainState(wm, userId);
  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, state.text, {
    reply_markup: state.reply_markup,
  });
};

const editToMain = async (
  env: Env,
  query: TelegramCallbackQuery,
): Promise<void> => {
  const chatId = query.message?.chat.id;
  const messageId = query.message?.message_id;
  if (chatId === undefined || messageId === undefined) return;
  const wm = buildManager(env);
  const state = await renderMainState(wm, query.from.id);
  await editMessageText(
    env.TELEGRAM_BOT_TOKEN,
    chatId,
    messageId,
    state.text,
    { reply_markup: state.reply_markup },
  );
};

const handleCreate: CallbackHandler = async ({ env, query }) => {
  const wm = buildManager(env);
  try {
    const wallet = await wm.createWallet(query.from.id);
    await editToMain(env, query);
    return { text: `Created ${truncateAddress(wallet.address)}` };
  } catch (err) {
    if (err instanceof TooManyWalletsError) {
      return {
        text: `Wallet cap reached (${MAX_WALLETS_PER_USER}). Delete one first.`,
        show_alert: true,
      };
    }
    throw err;
  }
};

const handleSwitchPicker: CallbackHandler = async ({ env, query }) => {
  const wm = buildManager(env);
  const userId = query.from.id;
  const wallets = await wm.listWallets(userId);
  if (wallets.length === 0) {
    return { text: "No wallets to switch to.", show_alert: true };
  }
  const active = await wm.getActive(userId);
  const chatId = query.message?.chat.id;
  const messageId = query.message?.message_id;
  if (chatId === undefined || messageId === undefined) return;
  await editMessageText(
    env.TELEGRAM_BOT_TOKEN,
    chatId,
    messageId,
    "Pick the wallet to use as active:",
    {
      reply_markup: {
        inline_keyboard: buildWalletSwitchKeyboard(wallets, active?.id ?? null),
      },
    },
  );
};

const handleSwitchTo: CallbackHandler = async ({ env, query, args }) => {
  const walletId = args[0];
  if (!walletId) return { text: "Invalid switch target." };
  const wm = buildManager(env);
  try {
    await wm.setActive(query.from.id, walletId);
  } catch (err) {
    if (err instanceof WalletNotFoundError) {
      return { text: "Wallet no longer exists.", show_alert: true };
    }
    throw err;
  }
  const wallet = await wm.getWallet(query.from.id, walletId);
  await editToMain(env, query);
  return {
    text: wallet?.label
      ? `Switched to ${wallet.label}`
      : "Switched.",
  };
};

const handleMainBack: CallbackHandler = async ({ env, query }) => {
  await editToMain(env, query);
};

/**
 * Stubs for actions that require infra still in flight. Surfaced as a
 * toast (`show_alert: true`) so users see a clear "not yet" instead of
 * a silent button. The keys are reserved here so future PRs only add
 * the handler body without renaming `callback_data`.
 */
const stubScene: CallbackHandler = async () => ({
  text: "Coming soon — needs the multi-step wizard infra.",
  show_alert: true,
});

const stubPin: CallbackHandler = async () => ({
  text: "Coming soon — needs the PIN flow.",
  show_alert: true,
});

callbackHandlers.set(WALLET_CALLBACK.create, handleCreate);
callbackHandlers.set(WALLET_CALLBACK.switchPicker, handleSwitchPicker);
callbackHandlers.set(WALLET_CALLBACK.switchTo, handleSwitchTo);
callbackHandlers.set(WALLET_CALLBACK.mainBack, handleMainBack);
callbackHandlers.set(WALLET_CALLBACK.import, stubScene);
callbackHandlers.set(WALLET_CALLBACK.rename, stubScene);
callbackHandlers.set(WALLET_CALLBACK.delete, stubPin);
callbackHandlers.set(WALLET_CALLBACK.exportKey, stubPin);
callbackHandlers.set(WALLET_CALLBACK.withdraw, stubPin);
