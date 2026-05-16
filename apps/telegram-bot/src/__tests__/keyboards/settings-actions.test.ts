import { describe, expect, it } from "vitest";

import {
  DEFAULT_TIP_PRESETS_GWEI,
  MAX_TIP_GWEI,
  SETTINGS_CALLBACK,
  buildExecSpeedKeyboard,
  buildSettingsKeyboard,
  decodeTipPresetSlot,
  encodeTipPresetSlot,
  formatTipLabel,
  normaliseTipPresets,
  resolveActiveTipGwei,
} from "../../keyboards/settings-actions.js";

interface ButtonShape {
  text: string;
  callback_data?: string;
}

const flatLabels = (rows: ButtonShape[][]): string[] =>
  rows.flat().map((b) => b.text);

describe("execution-speed presets (issue #967)", () => {
  it("defaults are [0.5, 0.15, 0.1] gwei", () => {
    expect([...DEFAULT_TIP_PRESETS_GWEI]).toEqual([0.5, 0.15, 0.1]);
  });

  it("normalises an undefined stored list to the defaults", () => {
    expect(normaliseTipPresets(undefined)).toEqual([0.5, 0.15, 0.1]);
  });

  it("clamps an out-of-range slot back to that slot's default", () => {
    const normalised = normaliseTipPresets([999, 0, 2]);
    // Slot 0 over MAX_TIP_GWEI → falls back to default 0.5.
    expect(normalised[0]).toBe(0.5);
    // Slot 1 under MIN_TIP_GWEI → falls back to default 0.15.
    expect(normalised[1]).toBe(0.15);
    // Slot 2 in-range → kept verbatim.
    expect(normalised[2]).toBe(2);
  });

  it("preserves valid slot values inside [MIN_TIP_GWEI, MAX_TIP_GWEI]", () => {
    expect(normaliseTipPresets([1, 0.5, 0.01])).toEqual([1, 0.5, 0.01]);
  });

  it("normalises a list of the wrong length back to defaults", () => {
    expect(normaliseTipPresets([0.5])).toEqual([0.5, 0.15, 0.1]);
  });

  it("rejects NaN / Infinity per-slot", () => {
    expect(normaliseTipPresets([NaN, Infinity, -1])).toEqual([0.5, 0.15, 0.1]);
  });
});

describe("resolveActiveTipGwei", () => {
  it("falls back to slot 0 when the stored active value is undefined", () => {
    expect(resolveActiveTipGwei([0.5, 0.15, 0.1], undefined)).toBe(0.5);
  });

  it("returns the stored value when it is finite and in range", () => {
    expect(resolveActiveTipGwei([0.5, 0.15, 0.1], 0.15)).toBe(0.15);
  });

  it("falls back to slot 0 when the stored value is out of range", () => {
    expect(resolveActiveTipGwei([0.5, 0.15, 0.1], MAX_TIP_GWEI + 1)).toBe(0.5);
    expect(resolveActiveTipGwei([0.5, 0.15, 0.1], 0)).toBe(0.5);
  });
});

describe("buildExecSpeedKeyboard", () => {
  it("marks the active slot with bullets and prefixes inactive slots with ✏️", () => {
    const rows = buildExecSpeedKeyboard([0.5, 0.15, 0.1], 0.15);
    const labels = flatLabels(rows);
    expect(labels).toContain("✏️ 0.5 gwei");
    expect(labels).toContain("• 0.15 gwei •");
    expect(labels).toContain("✏️ 0.1 gwei");
  });

  it("encodes the slot index in the callback payload", () => {
    const rows = buildExecSpeedKeyboard([0.5, 0.15, 0.1], 0.5);
    const callbacks = rows
      .flat()
      .map((b) => ("callback_data" in b ? b.callback_data : undefined))
      .filter((d): d is string => typeof d === "string");
    expect(callbacks).toContain(encodeTipPresetSlot(0));
    expect(callbacks).toContain(encodeTipPresetSlot(1));
    expect(callbacks).toContain(encodeTipPresetSlot(2));
  });
});

describe("tip preset slot callbacks", () => {
  it("encodes a numeric slot index and round-trips through decode", () => {
    expect(decodeTipPresetSlot(encodeTipPresetSlot(2))).toBe(2);
  });

  it("rejects non-numeric or unprefixed payloads", () => {
    expect(decodeTipPresetSlot("set:tpsabc")).toBeNull();
    expect(decodeTipPresetSlot("set:bp0")).toBeNull();
  });
});

describe("formatTipLabel", () => {
  it("renders integers without a decimal point", () => {
    expect(formatTipLabel(2)).toBe("2 gwei");
  });

  it("strips trailing zeros from fractional tips", () => {
    expect(formatTipLabel(0.5)).toBe("0.5 gwei");
    expect(formatTipLabel(0.1)).toBe("0.1 gwei");
    expect(formatTipLabel(0.15)).toBe("0.15 gwei");
  });
});

describe("buildSettingsKeyboard", () => {
  it("exposes the Execution Speed entry above Buy/Sell Settings", () => {
    const rows = buildSettingsKeyboard({
      slippageBps: 1000,
      defaultBuyUsdc: 20,
      degenMode: true,
      antiPhishingPhrase: null,
      executionTipGwei: 0.5,
    });
    const flat = rows.flat();
    const execIdx = flat.findIndex((b) =>
      typeof b.text === "string" && b.text.startsWith("Execution Speed:"),
    );
    const buyIdx = flat.findIndex((b) => b.text === "Buy Settings");
    expect(execIdx).toBeGreaterThan(-1);
    expect(buyIdx).toBeGreaterThan(execIdx);
    const execButton = flat[execIdx]!;
    if (!("callback_data" in execButton)) {
      throw new Error("Execution Speed button has no callback_data");
    }
    expect(execButton.callback_data).toBe(SETTINGS_CALLBACK.execSettings);
    expect(execButton.text).toContain("0.5 gwei");
  });
});
