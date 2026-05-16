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
  execSettings: "set:es", // issue #967 — opens the execution-speed sub-menu
  /**
   * Per-slot execution-speed tip button (issue #967). Encoded as
   * `set:tps<idx>`. Tapping a slot that is NOT currently active
   * selects it as the new active tip; tapping the active slot opens
   * the edit wizard so the user can change that slot's gwei value.
   * Dual-mode keeps the sub-menu at three buttons total instead of six
   * (one select + one pencil per slot).
   */
  tipPresetSlot: "set:tps",
  buyPresetSlot: "set:bp", // appended with slot index 0..4
  sellPresetSlot: "set:sp", // appended with slot index 0..4
  degenToggle: "set:dgn",
  phraseSet: "set:phr",
  phraseClear: "set:phrclr",
} as const;

/** Slippage presets surfaced as one-tap buttons. Values are bps. */
export const SLIPPAGE_PRESETS_BPS: readonly number[] = [500, 1000, 1500, 2000];

export interface SettingsStatus {
  slippageBps: number;
  defaultBuyUsdc: number;
  degenMode: boolean;
  antiPhishingPhrase: string | null;
  executionTipGwei: number;
}

/**
 * Defaults for the execution-speed tip sub-menu (issue #967). Slot 0
 * is also the default active tip; the higher the tip, the higher the
 * chance the block builder picks the bot's tx in the next block.
 */
export const DEFAULT_TIP_PRESETS_GWEI: readonly number[] = [0.5, 0.15, 0.1];

/** Number of tip preset slots on the execution-speed sub-menu. */
export const TIP_PRESETS_LENGTH = 3;

/**
 * Minimum tip (gwei). A zero tip is what got us into issue #967 in the
 * first place — disallow it so the user cannot edit a slot back into
 * the broken state.
 */
export const MIN_TIP_GWEI = 0.001;

/**
 * Max tip (gwei). Past this every reasonable HyperEVM tx is paying
 * orders of magnitude more than the prod-jp 2 gwei baseline — almost
 * certainly a fat-fingered decimal point rather than an intentional
 * setting, so we cap at the wizard layer.
 */
export const MAX_TIP_GWEI = 100;

/** `set:tps<idx>` — callback for the i-th tip-preset slot. */
export const encodeTipPresetSlot = (idx: number): string =>
  `${SETTINGS_CALLBACK.tipPresetSlot}${idx}`;

export const decodeTipPresetSlot = (data: string): number | null => {
  if (!data.startsWith(SETTINGS_CALLBACK.tipPresetSlot)) return null;
  const rest = data.slice(SETTINGS_CALLBACK.tipPresetSlot.length);
  if (!/^\d+$/.test(rest)) return null;
  const n = Number(rest);
  return Number.isInteger(n) ? n : null;
};

/**
 * Normalise the stored tip-preset array against `[MIN_TIP_GWEI,
 * MAX_TIP_GWEI]`. Sessions written before issue #967 have no
 * `executionTipPresetsGwei`; readers fall back to the defaults.
 * Out-of-range slots fall back to the same-index default.
 */
export const normaliseTipPresets = (
  stored: readonly number[] | undefined,
): number[] => {
  const base =
    Array.isArray(stored) && stored.length === TIP_PRESETS_LENGTH
      ? stored
      : DEFAULT_TIP_PRESETS_GWEI;
  return base.map((raw, idx) => {
    if (!Number.isFinite(raw) || raw < MIN_TIP_GWEI || raw > MAX_TIP_GWEI) {
      return DEFAULT_TIP_PRESETS_GWEI[idx]!;
    }
    return raw;
  });
};

/**
 * Resolve the active tip (gwei). Older sessions store no
 * `executionTipGwei` — fall back to slot 0 of the (normalised) preset
 * list, which is also the default 0.5 gwei for fresh installs.
 */
export const resolveActiveTipGwei = (
  presets: readonly number[],
  active: number | undefined,
): number => {
  if (
    typeof active === "number" &&
    Number.isFinite(active) &&
    active >= MIN_TIP_GWEI &&
    active <= MAX_TIP_GWEI
  ) {
    return active;
  }
  return presets[0] ?? DEFAULT_TIP_PRESETS_GWEI[0]!;
};

/** Compact label for a gwei tip — strips trailing zeros to keep buttons tight. */
export const formatTipLabel = (gwei: number): string => {
  if (Number.isInteger(gwei)) return `${gwei} gwei`;
  // 0.5 → "0.5", 0.15 → "0.15", 0.1 → "0.1". Strip trailing zeros and
  // a dangling dot.
  const s = gwei.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  return `${s} gwei`;
};

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

  const phraseRow =
    status.antiPhishingPhrase === null
      ? [
          {
            text: "Set anti-phishing phrase",
            callback_data: SETTINGS_CALLBACK.phraseSet,
          },
        ]
      : [
          { text: "Change phrase", callback_data: SETTINGS_CALLBACK.phraseSet },
          {
            text: "Clear phrase",
            callback_data: SETTINGS_CALLBACK.phraseClear,
          },
        ];

  return [
    slipRow,
    [
      {
        text: `Execution Speed: ${formatTipLabel(status.executionTipGwei)}`,
        callback_data: SETTINGS_CALLBACK.execSettings,
      },
    ],
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
    phraseRow,
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
 * Render the 3-slot Execution Speed sub-menu (issue #967). Each slot
 * is a dual-mode button:
 *   - Tap an inactive slot → select it as the new active tip.
 *   - Tap the active slot   → open the gwei edit wizard for that slot.
 * The active slot is bookended with `•` so the user can tell which
 * value is currently being plumbed into `maxPriorityFeePerGas`.
 */
export const buildExecSpeedKeyboard = (
  tipPresetsGwei: readonly number[],
  activeTipGwei: number,
): InlineKeyboard => {
  const buttons = tipPresetsGwei.map((gwei, idx) => {
    const isActive = gwei === activeTipGwei;
    return {
      text: isActive
        ? `• ${formatTipLabel(gwei)} •`
        : `✏️ ${formatTipLabel(gwei)}`,
      callback_data: encodeTipPresetSlot(idx),
    };
  });
  return [buttons, backHomeRow()];
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
