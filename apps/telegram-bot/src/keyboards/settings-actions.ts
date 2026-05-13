import { closeButtonRow } from "../lib/close.js";
import type { InlineKeyboard } from "./wallet-actions.js";

/**
 * Callback codes for `/settings`. Prefixed `set:` to stay clear of
 * `sec:*` (security) and well inside the 64-byte `callback_data`
 * budget (`set:slip500` = 11 bytes).
 */
export const SETTINGS_CALLBACK = {
  slipPreset: "set:slip", // appended with bps value, e.g. `set:slip500`
  slipCustom: "set:slipx",
  buyAmount: "set:buy",
  degenToggle: "set:dgn",
} as const;

/** Slippage presets surfaced as one-tap buttons. Values are bps. */
export const SLIPPAGE_PRESETS_BPS: readonly number[] = [500, 1000, 1500, 2000];

export interface SettingsStatus {
  slippageBps: number;
  defaultBuyUsdc: number;
  degenMode: boolean;
}

/** `set:slip<bps>` — encode a preset bps value into a compact callback string. */
export const encodeSlippagePreset = (bps: number): string =>
  `${SETTINGS_CALLBACK.slipPreset}${bps}`;

/** Pulls the bps integer back out of a `set:slip<bps>` callback payload. */
export const decodeSlippagePreset = (data: string): number | null => {
  if (!data.startsWith(SETTINGS_CALLBACK.slipPreset)) return null;
  const rest = data.slice(SETTINGS_CALLBACK.slipPreset.length);
  if (!/^\d+$/.test(rest)) return null;
  const n = Number(rest);
  return Number.isFinite(n) ? n : null;
};

/**
 * Render the `/settings` status panel keyboard:
 *   Row 1: slippage presets (current selection marked) + custom
 *   Row 2: change default buy amount
 *   Row 3: degen mode toggle (label flips between Enable / Disable)
 */
export const buildSettingsKeyboard = (
  status: SettingsStatus,
): InlineKeyboard => {
  const slipRow = SLIPPAGE_PRESETS_BPS.map((bps) => ({
    text:
      bps === status.slippageBps
        ? `• ${formatBpsLabel(bps)} •`
        : formatBpsLabel(bps),
    callback_data: encodeSlippagePreset(bps),
  }));
  slipRow.push({
    text: "Custom %",
    callback_data: SETTINGS_CALLBACK.slipCustom,
  });

  return [
    slipRow,
    [
      {
        text: `Default buy: $${status.defaultBuyUsdc}`,
        callback_data: SETTINGS_CALLBACK.buyAmount,
      },
    ],
    [
      {
        text: status.degenMode ? "Disable degen mode" : "Enable degen mode",
        callback_data: SETTINGS_CALLBACK.degenToggle,
      },
    ],
    closeButtonRow(),
  ];
};

const formatBpsLabel = (bps: number): string => {
  const pct = bps / 100;
  if (Number.isInteger(pct)) return `${pct}%`;
  // Render `50 bps` as `0.5%`, not `0.50%` — strip trailing zeros so
  // the label stays compact on inline buttons.
  return `${pct.toFixed(2).replace(/\.?0+$/, "")}%`;
};

export { formatBpsLabel };
