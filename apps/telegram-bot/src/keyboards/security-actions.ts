import type { InlineKeyboard } from "./wallet-actions.js";

/**
 * Callback codes for `/security`. Each chosen short so the 64-byte
 * `callback_data` budget is never tight (`sec:setpin` = 10 bytes).
 */
export const SECURITY_CALLBACK = {
  setPin: "sec:setpin",
  changePin: "sec:chpin",
  resetPin: "sec:rstpin",
  cancelReset: "sec:rstcan",
  completeReset: "sec:rstdo",
  setPhrase: "sec:phr",
  clearPhrase: "sec:phrclr",
  enableLock: "sec:lken",
  disableLock: "sec:lkdis",
  cancelDisable: "sec:lkcan",
} as const;

export interface SecurityStatus {
  pinSet: boolean;
  pinResetPending: boolean;
  pinResetReady: boolean;
  withdrawLockEnabled: boolean;
  withdrawDisablePending: boolean;
  antiPhishingPhrase: string | null;
}

/**
 * Main `/security` view keyboard. Visible action set is a function of
 * status so we never render a button that immediately errors:
 *   - PIN row toggles between Set (no PIN) / Change (PIN set) — plus
 *     Reset request when a PIN is set, or Cancel/Complete when a reset
 *     is in flight.
 *   - Phrase row offers Set when no phrase, Change + Clear otherwise.
 *   - Lock row toggles Enable / Disable, with a Cancel button when a
 *     disable is mid-cooldown.
 */
export const buildSecurityKeyboard = (
  status: SecurityStatus,
): InlineKeyboard => {
  const rows: InlineKeyboard = [];

  if (!status.pinSet) {
    rows.push([{ text: "Set PIN", callback_data: SECURITY_CALLBACK.setPin }]);
  } else if (status.pinResetReady) {
    rows.push([
      { text: "Complete PIN reset", callback_data: SECURITY_CALLBACK.completeReset },
      { text: "Cancel reset", callback_data: SECURITY_CALLBACK.cancelReset },
    ]);
  } else if (status.pinResetPending) {
    rows.push([
      { text: "Cancel PIN reset", callback_data: SECURITY_CALLBACK.cancelReset },
    ]);
  } else {
    rows.push([
      { text: "Change PIN", callback_data: SECURITY_CALLBACK.changePin },
      { text: "Reset PIN", callback_data: SECURITY_CALLBACK.resetPin },
    ]);
  }

  if (status.antiPhishingPhrase === null) {
    rows.push([
      { text: "Set anti-phishing phrase", callback_data: SECURITY_CALLBACK.setPhrase },
    ]);
  } else {
    rows.push([
      { text: "Change phrase", callback_data: SECURITY_CALLBACK.setPhrase },
      { text: "Clear phrase", callback_data: SECURITY_CALLBACK.clearPhrase },
    ]);
  }

  if (!status.withdrawLockEnabled) {
    rows.push([
      { text: "Enable withdrawal lock", callback_data: SECURITY_CALLBACK.enableLock },
    ]);
  } else if (status.withdrawDisablePending) {
    rows.push([
      { text: "Cancel disable", callback_data: SECURITY_CALLBACK.cancelDisable },
    ]);
  } else {
    rows.push([
      { text: "Disable withdrawal lock", callback_data: SECURITY_CALLBACK.disableLock },
    ]);
  }

  return rows;
};
