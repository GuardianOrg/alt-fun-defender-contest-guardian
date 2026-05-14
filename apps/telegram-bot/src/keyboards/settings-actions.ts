import { backHomeRow } from "../lib/nav.js";
import type { InlineKeyboard } from "./wallet-actions.js";

/**
 * Callback codes for `/settings`. Prefixed `set:` to stay clear of
 * `sec:*` (security) and well inside the 64-byte `callback_data`
 * budget (`set:slip500` = 11 bytes).
 *
 * Buy/Sell sub-menus (issue #818) live under `set:bs` / `set:ss` and
 * per-slot edit prompts under `set:bp<i>` / `set:sp<i>` where `i`
 * is the slot index (0..4).
 */
export const SETTINGS_CALLBACK = {
  slipPreset: "set:slip", // appended with bps value, e.g. `set:slip500`
  slipCustom: "set:slipx",
  buySettings: "set:bs",
  sellSettings: "set:ss",
  buyPresetSlot: "set:bp", // appended with slot index 0..4
  sellPresetSlot: "set:sp", // appended with slot index 0..4
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

/** `set:bp<idx>` — callback for the i-th buy-preset slot. */
export const encodeBuyPresetSlot = (idx: number): string =>
  `${SETTINGS_CALLBACK.buyPresetSlot}${idx}`;

export const decodeBuyPresetSlot = (data: string): number | null => {
  if (!data.startsWith(SETTINGS_CALLBACK.buyPresetSlot)) return null;
  const rest = data.slice(SETTINGS_CALLBACK.buyPresetSlot.length);
  if (!/^\d+$/.test(rest)) return null;
  const n = Number(rest);
  return Number.isInteger(n) ? n : null;
};

/** `set:sp<idx>` — callback for the i-th sell-preset slot. */
export const encodeSellPresetSlot = (idx: number): string =>
  `${SETTINGS_CALLBACK.sellPresetSlot}${idx}`;

export const decodeSellPresetSlot = (data: string): number | null => {
  if (!data.startsWith(SETTINGS_CALLBACK.sellPresetSlot)) return null;
  const rest = data.slice(SETTINGS_CALLBACK.sellPresetSlot.length);
  if (!/^\d+$/.test(rest)) return null;
  const n = Number(rest);
  return Number.isInteger(n) ? n : null;
};

/**
 * Render the `/settings` status panel keyboard:
 *   Row 1: slippage presets (current selection marked) + custom
 *   Row 2: Buy Settings → opens the 5-slot sub-menu (issue #818)
 *   Row 3: Sell Settings → opens the 5-slot sub-menu
 *   Row 4: degen mode toggle
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
        text: "Buy Settings",
        callback_data: SETTINGS_CALLBACK.buySettings,
      },
      {
        text: "Sell Settings",
        callback_data: SETTINGS_CALLBACK.sellSettings,
      },
    ],
    [
      {
        text: status.degenMode ? "🟢 Degen mode" : "🔴 Degen mode",
        callback_data: SETTINGS_CALLBACK.degenToggle,
      },
    ],
    backHomeRow(),
  ];
};

/**
 * Render the 5-slot Buy Settings sub-menu. Slots are laid out 3-on-top,
 * 2-on-bottom so the row of buttons mirrors the natural reading order
 * of the presets (e.g. `20 / 40 / 60` then `80 / 100`). A trailing
 * Back / Home row returns the user to the main /settings panel.
 */
export const buildBuySettingsKeyboard = (
  buyPresetsUsdc: readonly number[],
): InlineKeyboard => {
  const buttons = buyPresetsUsdc.map((amount, idx) => ({
    text: `✏️ ${amount} USDC`,
    callback_data: encodeBuyPresetSlot(idx),
  }));
  return [buttons.slice(0, 3), buttons.slice(3), backHomeRow()];
};

export const buildSellSettingsKeyboard = (
  sellPresetsPct: readonly number[],
): InlineKeyboard => {
  const buttons = sellPresetsPct.map((pct, idx) => ({
    text: `✏️ ${pct}%`,
    callback_data: encodeSellPresetSlot(idx),
  }));
  return [buttons.slice(0, 3), buttons.slice(3), backHomeRow()];
};

const formatBpsLabel = (bps: number): string => {
  const pct = bps / 100;
  if (Number.isInteger(pct)) return `${pct}%`;
  // Render `50 bps` as `0.5%`, not `0.50%` — strip trailing zeros so
  // the label stays compact on inline buttons.
  return `${pct.toFixed(2).replace(/\.?0+$/, "")}%`;
};

export { formatBpsLabel };
