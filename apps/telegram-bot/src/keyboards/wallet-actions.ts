import { backHomeRow } from "../lib/nav.js";
import type { StoredWallet } from "../lib/wallet.js";

export interface InlineCallbackButton {
  text: string;
  callback_data: string;
}

export interface InlineUrlButton {
  text: string;
  url: string;
}

export type InlineKeyboardButton = InlineCallbackButton | InlineUrlButton;

export type InlineKeyboard = InlineKeyboardButton[][];

/**
 * Short callback codes — each chosen to stay well inside the 64-byte
 * `callback_data` budget even when combined with a `w_xxxxxx` walletId
 * arg (`ws:w_xxxxxx` = 11 bytes).
 *
 * The `wp*` / `wl*` codes own the PIN and withdrawal-lock surfaces
 * that moved out of `/security` into the `/wallet` panel — each
 * panel re-renders itself on action, which means each panel needs
 * its own callback prefix.
 */
export const WALLET_CALLBACK = {
  create: "wc",
  switchPicker: "wsp",
  switchTo: "ws",
  rename: "wr",
  import: "wi",
  exportKey: "we",
  /**
   * Inline button on the export-key reveal message. Lets the user
   * delete the plaintext-key bubble immediately rather than waiting
   * for the 30s auto-delete sweep. The button takes no argument — the
   * handler reads `ctx.callbackQuery.message.message_id` directly,
   * keeping the callback_data tiny (3 bytes).
   */
  exportDelete: "wed",
  delete: "wd",
  withdraw: "ww",
  pinSet: "wps",
  pinChange: "wpc",
  pinReset: "wpr",
  pinCancelReset: "wprc",
  pinCompleteReset: "wprd",
  lockEnable: "wle",
  lockDisable: "wld",
  lockCancelDisable: "wlc",
} as const;

export interface WalletSecurityStatus {
  pinSet: boolean;
  pinResetPending: boolean;
  pinResetReady: boolean;
  withdrawLockEnabled: boolean;
  /**
   * `disableRequestedAt` is set and the 24h cooldown has NOT elapsed.
   * Panel surfaces the cancel button; the final disable cannot fire
   * yet (SecurityState re-checks the clock at write time).
   */
  withdrawDisablePending: boolean;
  /**
   * `disableRequestedAt` is set and the 24h cooldown HAS elapsed.
   * Panel surfaces a [Complete disable] + [Cancel disable] row so the
   * user can land the disable or back out — without this, a refreshed
   * panel after 24h still only renders the cancel button and the user
   * is wedged in pending forever.
   */
  withdrawDisableReady: boolean;
}

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
  security: WalletSecurityStatus,
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
  rows.push(buildPinRow(security));
  if (security.withdrawDisableReady) {
    // Ready state takes a dedicated row so the [Complete disable] +
    // [Cancel disable] pair fits without crowding the Withdraw button
    // onto a single 3-button row that overflows on narrow clients.
    if (hasActive) {
      rows.push([
        { text: "Withdraw", callback_data: WALLET_CALLBACK.withdraw },
      ]);
    }
    rows.push([
      {
        text: "🟠 Complete disable",
        callback_data: WALLET_CALLBACK.lockDisable,
      },
      {
        text: "Cancel disable",
        callback_data: WALLET_CALLBACK.lockCancelDisable,
      },
    ]);
  } else if (hasActive) {
    rows.push([
      { text: "Withdraw", callback_data: WALLET_CALLBACK.withdraw },
      buildLockButton(security),
    ]);
  } else {
    rows.push([buildLockButton(security)]);
  }
  rows.push(backHomeRow());
  return rows;
};

/**
 * PIN row reflects the current PIN state so users never see a button
 * that would immediately error: no PIN yet → just Set PIN; pending
 * reset → revoke / complete only; otherwise → Change / Reset.
 */
const buildPinRow = (
  security: WalletSecurityStatus,
): InlineCallbackButton[] => {
  if (!security.pinSet) {
    return [{ text: "Set PIN", callback_data: WALLET_CALLBACK.pinSet }];
  }
  if (security.pinResetReady) {
    return [
      {
        text: "Complete PIN reset",
        callback_data: WALLET_CALLBACK.pinCompleteReset,
      },
      { text: "Cancel reset", callback_data: WALLET_CALLBACK.pinCancelReset },
    ];
  }
  if (security.pinResetPending) {
    return [
      {
        text: "Cancel PIN reset",
        callback_data: WALLET_CALLBACK.pinCancelReset,
      },
    ];
  }
  return [
    { text: "Change PIN", callback_data: WALLET_CALLBACK.pinChange },
    { text: "Reset PIN", callback_data: WALLET_CALLBACK.pinReset },
  ];
};

/**
 * Withdrawal-lock toggle button. The leading 🟢 / 🔴 indicator
 * replaces the old "Enable" / "Disable" word so the on/off state is
 * legible at a glance next to the Withdraw button. The ready-to-
 * complete branch is handled in the parent layout via a two-button
 * row, not here — this helper only emits the single-button cases.
 */
const buildLockButton = (
  security: WalletSecurityStatus,
): InlineCallbackButton => {
  if (!security.withdrawLockEnabled) {
    return {
      text: "🔴 Withdrawal lock",
      callback_data: WALLET_CALLBACK.lockEnable,
    };
  }
  if (security.withdrawDisablePending) {
    return {
      text: "🟢 Withdrawal lock (cancel disable)",
      callback_data: WALLET_CALLBACK.lockCancelDisable,
    };
  }
  return {
    text: "🟢 Withdrawal lock",
    callback_data: WALLET_CALLBACK.lockDisable,
  };
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
  rows.push(backHomeRow());
  return rows;
};
