import {
  DEFAULT_LANGUAGE,
  type Language,
  SETTINGS_BUY_PRESET_BUTTON,
  SETTINGS_BUY_SETTINGS_BUTTON,
  SETTINGS_CHANGE_PHRASE_BUTTON,
  SETTINGS_CLEAR_PHRASE_BUTTON,
  SETTINGS_CUSTOM_PERCENT_BUTTON,
  SETTINGS_DEGEN_MODE_OFF_BUTTON,
  SETTINGS_DEGEN_MODE_ON_BUTTON,
  SETTINGS_EXECUTION_SPEED_HEADER_BUTTON,
  SETTINGS_LANGUAGE_ENGLISH_BUTTON,
  SETTINGS_LANGUAGE_HEADER_BUTTON,
  SETTINGS_LANGUAGE_SIMPLIFIED_CHINESE_BUTTON,
  SETTINGS_SELL_PRESET_BUTTON,
  SETTINGS_SELL_SETTINGS_BUTTON,
  SETTINGS_SET_PHRASE_BUTTON,
  SETTINGS_SLIPPAGE_HEADER_BUTTON,
  SPEED_PRESET_ECO,
  SPEED_PRESET_FAST,
  SPEED_PRESET_LIGHTNING,
  t,
} from "../lib/i18n.js";
import { backHomeRow } from "../lib/nav.js";
import type { InlineKeyboard } from "./wallet-actions.js";

/**
 * Callback codes for `/settings`. Prefixed `set:` to stay clear of
 * `sec:*` (security) and well inside the 64-byte `callback_data`
 * budget (`set:slip500` = 11 bytes).
 *
 * Buy/Sell sub-menus (issue #818) live under `set:bs` / `set:ss` and
 * per-slot edit prompts under `set:bp<i>` / `set:sp<i>` where `i`
 * is the slot index (0..4). Execution-speed presets sit inline on the
 * main panel under `set:tps<idx>` and are not user-editable — only the
 * active selection is mutable.
 */
export const SETTINGS_CALLBACK = {
  slipPreset: "set:slip", // appended with bps value, e.g. `set:slip500`
  slipCustom: "set:slipx",
  buySettings: "set:bs",
  sellSettings: "set:ss",
  /**
   * Tap on one of the three inline execution-speed buttons
   * (Lightning / Fast / Eco). Encoded as `set:tps<idx>`. Selecting an
   * inactive button promotes it to the active tip; values are fixed
   * (see `SPEED_PRESETS`) so there is no edit affordance.
   */
  speedPreset: "set:tps",
  buyPresetSlot: "set:bp", // appended with slot index 0..4
  sellPresetSlot: "set:sp", // appended with slot index 0..4
  degenToggle: "set:dgn",
  phraseSet: "set:phr",
  phraseClear: "set:phrclr",
  /**
   * Switch the user's UI language. Encoded as `set:lang:<Language>`,
   * where `<Language>` is the `Language` union member name
   * (`English`, `SimplifiedChinese`). The handler ignores taps on the
   * currently-active language and re-renders the panel in the new
   * language for any other value.
   */
  language: "set:lang",
  /**
   * Inert callback used by the `-- Slippage --` / `-- Execution Speed --`
   * section header buttons. The handler answers the callback query so
   * Telegram stops the loading spinner, but the panel does not change.
   */
  noop: "set:noop",
} as const;

/** `set:lang:<Language>` — encode a language selection for callback_data. */
export const encodeLanguagePreset = (lang: Language): string =>
  `${SETTINGS_CALLBACK.language}:${lang}`;

/**
 * Pull a `Language` back out of a `set:lang:<Language>` callback. Returns
 * null for an unrecognised tail so a tampered callback is a no-op rather
 * than a TypeScript-defeated `as Language`.
 */
export const decodeLanguagePreset = (data: string): Language | null => {
  const prefix = `${SETTINGS_CALLBACK.language}:`;
  if (!data.startsWith(prefix)) return null;
  const rest = data.slice(prefix.length);
  if (rest === "English" || rest === "SimplifiedChinese") return rest;
  return null;
};

/** Slippage presets surfaced as one-tap buttons. Values are bps. */
export const SLIPPAGE_PRESETS_BPS: readonly number[] = [500, 1000, 1500, 2000];

export interface SpeedPreset {
  readonly label: import("../lib/i18n.js").Localised<string>;
  readonly gwei: number;
}

/**
 * Fixed execution-speed presets. The active selection is plumbed into
 * every trade as `maxPriorityFeePerGas`; the gwei values are not
 * user-editable — Lightning / Fast / Eco are the only choices, locked
 * to `0.5` / `0.15` / `0.1` gwei respectively. The higher the tip, the
 * higher the chance the block builder picks the bot's tx in the next
 * block.
 */
/**
 * Label is a Localised entry so the active preset name can render in
 * the user's preferred language. The preset list is fixed; only the
 * label text varies per locale.
 */
export const SPEED_PRESETS: readonly SpeedPreset[] = [
  { label: SPEED_PRESET_LIGHTNING, gwei: 0.5 },
  { label: SPEED_PRESET_FAST, gwei: 0.15 },
  { label: SPEED_PRESET_ECO, gwei: 0.1 },
];

/** Gwei values of the three fixed speed presets, in display order. */
export const SPEED_PRESET_GWEI: readonly number[] = SPEED_PRESETS.map(
  (p) => p.gwei,
);

export interface SettingsStatus {
  slippageBps: number;
  defaultBuyUsdc: number;
  degenMode: boolean;
  antiPhishingPhrase: string | null;
  executionTipGwei: number;
  /**
   * Optional so legacy test fixtures (and any session predating the
   * language picker) can omit it and still resolve to English via
   * `resolveStatusLanguage` below.
   */
  language?: Language;
}

const resolveStatusLanguage = (status: SettingsStatus): Language =>
  status.language ?? DEFAULT_LANGUAGE;

/** `set:tps<idx>` — callback for the i-th speed preset. */
export const encodeSpeedPreset = (idx: number): string =>
  `${SETTINGS_CALLBACK.speedPreset}${idx}`;

export const decodeSpeedPreset = (data: string): number | null => {
  if (!data.startsWith(SETTINGS_CALLBACK.speedPreset)) return null;
  const rest = data.slice(SETTINGS_CALLBACK.speedPreset.length);
  if (!/^\d+$/.test(rest)) return null;
  const n = Number(rest);
  return Number.isInteger(n) ? n : null;
};

/**
 * Resolve the active tip (gwei). Sessions written before the fixed
 * Lightning/Fast/Eco rollout may hold a value that no longer matches
 * any preset (or no value at all) — fall back to slot 0 (Lightning)
 * which is also the default for fresh installs. The clamp keeps a
 * stored custom tip from being silently plumbed into trades after the
 * UI lost its edit affordance.
 */
export const resolveActiveTipGwei = (active: number | undefined): number => {
  if (typeof active === "number" && SPEED_PRESET_GWEI.includes(active)) {
    return active;
  }
  return SPEED_PRESET_GWEI[0]!;
};

/**
 * Map a gwei tip to its preset label (Lightning / Fast / Eco). Used in
 * the `/settings` status line and the speed-preset ack toast so the
 * description mirrors the button the user tapped instead of leaking the
 * raw gwei value. Falls back to the slot-0 label for any value that
 * isn't a known preset — mirrors `resolveActiveTipGwei`'s clamp.
 */
export const formatTipPresetLabel = (
  gwei: number,
  lang: Language = DEFAULT_LANGUAGE,
): string => {
  const preset = SPEED_PRESETS.find((p) => p.gwei === gwei) ?? SPEED_PRESETS[0]!;
  return t(preset.label, lang);
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
 *   Row 1: `-- Slippage --` section header (inert)
 *   Row 2: slippage presets (current selection marked) + custom
 *   Row 3: `-- Execution Speed --` section header (inert)
 *   Row 4: Lightning / Fast / Eco speed presets (current selection marked)
 *   Row 5: `-- Language --` section header (inert)
 *   Row 6: language presets (English-only in v1, marked active)
 *   Row 7: Buy Settings + Sell Settings → opens the 5-slot sub-menus (issue #818)
 *   Row 8: anti-phishing phrase row
 *   Row 9: degen mode toggle
 *   Row 10: Back / Home
 */
export const buildSettingsKeyboard = (
  status: SettingsStatus,
): InlineKeyboard => {
  const lang = resolveStatusLanguage(status);
  const slipRow = SLIPPAGE_PRESETS_BPS.map((bps) => ({
    text:
      bps === status.slippageBps
        ? `• ${formatBpsLabel(bps)} •`
        : formatBpsLabel(bps),
    callback_data: encodeSlippagePreset(bps),
  }));
  slipRow.push({
    text: t(SETTINGS_CUSTOM_PERCENT_BUTTON, lang),
    callback_data: SETTINGS_CALLBACK.slipCustom,
  });

  const activeTip = resolveActiveTipGwei(status.executionTipGwei);
  const speedRow = SPEED_PRESETS.map((preset, idx) => {
    const label = t(preset.label, lang);
    return {
      text: preset.gwei === activeTip ? `• ${label} •` : label,
      callback_data: encodeSpeedPreset(idx),
    };
  });

  const englishLabel = t(SETTINGS_LANGUAGE_ENGLISH_BUTTON, lang);
  const chineseLabel = t(SETTINGS_LANGUAGE_SIMPLIFIED_CHINESE_BUTTON, lang);
  const languageRow = [
    {
      text: lang === "English" ? `• ${englishLabel} •` : englishLabel,
      callback_data: encodeLanguagePreset("English"),
    },
    {
      text:
        lang === "SimplifiedChinese" ? `• ${chineseLabel} •` : chineseLabel,
      callback_data: encodeLanguagePreset("SimplifiedChinese"),
    },
  ];

  const phraseRow =
    status.antiPhishingPhrase === null
      ? [
          {
            text: t(SETTINGS_SET_PHRASE_BUTTON, lang),
            callback_data: SETTINGS_CALLBACK.phraseSet,
          },
        ]
      : [
          {
            text: t(SETTINGS_CHANGE_PHRASE_BUTTON, lang),
            callback_data: SETTINGS_CALLBACK.phraseSet,
          },
          {
            text: t(SETTINGS_CLEAR_PHRASE_BUTTON, lang),
            callback_data: SETTINGS_CALLBACK.phraseClear,
          },
        ];

  return [
    [
      {
        text: t(SETTINGS_SLIPPAGE_HEADER_BUTTON, lang),
        callback_data: SETTINGS_CALLBACK.noop,
      },
    ],
    slipRow,
    [
      {
        text: t(SETTINGS_EXECUTION_SPEED_HEADER_BUTTON, lang),
        callback_data: SETTINGS_CALLBACK.noop,
      },
    ],
    speedRow,
    [
      {
        text: t(SETTINGS_LANGUAGE_HEADER_BUTTON, lang),
        callback_data: SETTINGS_CALLBACK.noop,
      },
    ],
    languageRow,
    [
      {
        text: t(SETTINGS_BUY_SETTINGS_BUTTON, lang),
        callback_data: SETTINGS_CALLBACK.buySettings,
      },
      {
        text: t(SETTINGS_SELL_SETTINGS_BUTTON, lang),
        callback_data: SETTINGS_CALLBACK.sellSettings,
      },
    ],
    phraseRow,
    [
      {
        text: status.degenMode
          ? t(SETTINGS_DEGEN_MODE_ON_BUTTON, lang)
          : t(SETTINGS_DEGEN_MODE_OFF_BUTTON, lang),
        callback_data: SETTINGS_CALLBACK.degenToggle,
      },
    ],
    backHomeRow(lang),
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
  lang: Language = DEFAULT_LANGUAGE,
): InlineKeyboard => {
  const buttons = buyPresetsUsdc.map((amount, idx) => ({
    text: t(SETTINGS_BUY_PRESET_BUTTON, lang)(amount),
    callback_data: encodeBuyPresetSlot(idx),
  }));
  return [buttons.slice(0, 3), buttons.slice(3), backHomeRow(lang)];
};

export const buildSellSettingsKeyboard = (
  sellPresetsPct: readonly number[],
  lang: Language = DEFAULT_LANGUAGE,
): InlineKeyboard => {
  const buttons = sellPresetsPct.map((pct, idx) => ({
    text: t(SETTINGS_SELL_PRESET_BUTTON, lang)(pct),
    callback_data: encodeSellPresetSlot(idx),
  }));
  return [buttons.slice(0, 3), buttons.slice(3), backHomeRow(lang)];
};

const formatBpsLabel = (bps: number): string => {
  const pct = bps / 100;
  if (Number.isInteger(pct)) return `${pct}%`;
  // Render `50 bps` as `0.5%`, not `0.50%` — strip trailing zeros so
  // the label stays compact on inline buttons.
  return `${pct.toFixed(2).replace(/\.?0+$/, "")}%`;
};

export { formatBpsLabel };
