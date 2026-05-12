import type { StoredWallet } from "../lib/wallet.js";

export interface InlineKeyboardButton {
  text: string;
  callback_data: string;
}

export type InlineKeyboard = InlineKeyboardButton[][];

/**
 * Short callback codes — each chosen to stay well inside the 64-byte
 * `callback_data` budget even when combined with a `w_xxxxxx` walletId
 * arg (`ws:w_xxxxxx` = 11 bytes).
 */
export const WALLET_CALLBACK = {
  create: "wc",
  switchPicker: "wsp",
  switchTo: "ws",
  mainBack: "wm",
  rename: "wr",
  import: "wi",
  exportKey: "we",
  delete: "wd",
  withdraw: "ww",
} as const;

const truncateAddress = (addr: string): string =>
  `${addr.slice(0, 6)}…${addr.slice(-4)}`;

/**
 * Main `/wallet` view keyboard. Action rows shown depend on user state
 * so users never see a button that immediately errors:
 *   - Create / Import are always available (subject to MAX_WALLETS_PER_USER on Create)
 *   - Switch / Rename / Delete / Export require at least one wallet
 *   - Withdraw requires an active wallet (the implicit signer)
 */
export const buildWalletMainKeyboard = (
  hasWallets: boolean,
  hasActive: boolean,
): InlineKeyboard => {
  const rows: InlineKeyboard = [
    [
      { text: "Create", callback_data: WALLET_CALLBACK.create },
      { text: "Import", callback_data: WALLET_CALLBACK.import },
    ],
  ];
  if (hasWallets) {
    rows.push([
      { text: "Switch", callback_data: WALLET_CALLBACK.switchPicker },
      { text: "Rename", callback_data: WALLET_CALLBACK.rename },
    ]);
    rows.push([
      { text: "Delete", callback_data: WALLET_CALLBACK.delete },
      { text: "Export key", callback_data: WALLET_CALLBACK.exportKey },
    ]);
  }
  if (hasActive) {
    rows.push([{ text: "Withdraw", callback_data: WALLET_CALLBACK.withdraw }]);
  }
  return rows;
};

/**
 * Switch-wallet picker. One button per wallet (with a `*` marker on the
 * current active one) plus a Back row that returns to the main view.
 * The marker keeps users oriented inside the picker without forcing a
 * round-trip to the main view to confirm what's active.
 */
export const buildWalletSwitchKeyboard = (
  wallets: StoredWallet[],
  activeId: string | null,
): InlineKeyboard => {
  const rows: InlineKeyboard = wallets.map((w) => [
    {
      text: `${w.id === activeId ? "* " : "  "}${w.label ?? "(unlabeled)"} — ${truncateAddress(w.address)}`,
      callback_data: `${WALLET_CALLBACK.switchTo}:${w.id}`,
    },
  ]);
  rows.push([{ text: "Back", callback_data: WALLET_CALLBACK.mainBack }]);
  return rows;
};
