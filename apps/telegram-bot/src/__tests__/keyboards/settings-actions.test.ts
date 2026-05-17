import { describe, expect, it } from "vitest";

import {
  SETTINGS_CALLBACK,
  SPEED_PRESETS,
  SPEED_PRESET_GWEI,
  buildSettingsKeyboard,
  decodeSpeedPreset,
  encodeSpeedPreset,
  formatTipPresetLabel,
  resolveActiveTipGwei,
} from "../../keyboards/settings-actions.js";

interface ButtonShape {
  text: string;
  callback_data?: string;
}

const flatLabels = (rows: ButtonShape[][]): string[] =>
  rows.flat().map((b) => b.text);

describe("execution-speed presets (inline)", () => {
  it("defaults are Lightning / Fast / Eco at 0.5 / 0.15 / 0.1 gwei", () => {
    expect(SPEED_PRESETS.map((p) => p.label)).toEqual([
      "Lightning",
      "Fast",
      "Eco",
    ]);
    expect([...SPEED_PRESET_GWEI]).toEqual([0.5, 0.15, 0.1]);
  });
});

describe("resolveActiveTipGwei", () => {
  it("falls back to Lightning (slot 0) when the stored active value is undefined", () => {
    expect(resolveActiveTipGwei(undefined)).toBe(0.5);
  });

  it("returns the stored value when it matches a preset", () => {
    expect(resolveActiveTipGwei(0.15)).toBe(0.15);
    expect(resolveActiveTipGwei(0.1)).toBe(0.1);
    expect(resolveActiveTipGwei(0.5)).toBe(0.5);
  });

  it("falls back to Lightning when the stored value is not a preset", () => {
    // Custom values from the removed edit wizard must not leak through —
    // the active tip can only be one of the three fixed presets.
    expect(resolveActiveTipGwei(2)).toBe(0.5);
    expect(resolveActiveTipGwei(0)).toBe(0.5);
    expect(resolveActiveTipGwei(NaN)).toBe(0.5);
  });
});

describe("speed preset callbacks", () => {
  it("encodes a numeric slot index and round-trips through decode", () => {
    expect(decodeSpeedPreset(encodeSpeedPreset(0))).toBe(0);
    expect(decodeSpeedPreset(encodeSpeedPreset(2))).toBe(2);
  });

  it("rejects non-numeric or unprefixed payloads", () => {
    expect(decodeSpeedPreset("set:tpsabc")).toBeNull();
    expect(decodeSpeedPreset("set:bp0")).toBeNull();
  });
});

describe("formatTipPresetLabel", () => {
  it("returns the preset label for each known gwei value", () => {
    expect(formatTipPresetLabel(0.5)).toBe("Lightning");
    expect(formatTipPresetLabel(0.15)).toBe("Fast");
    expect(formatTipPresetLabel(0.1)).toBe("Eco");
  });

  it("falls back to the slot-0 label for unknown values", () => {
    expect(formatTipPresetLabel(2)).toBe("Lightning");
    expect(formatTipPresetLabel(0)).toBe("Lightning");
    expect(formatTipPresetLabel(NaN)).toBe("Lightning");
  });
});

describe("buildSettingsKeyboard", () => {
  const baseStatus = {
    slippageBps: 1000,
    defaultBuyUsdc: 20,
    degenMode: true,
    antiPhishingPhrase: null,
    executionTipGwei: 0.5,
  };

  it("renders a '-- Slippage --' inert header row above the slippage presets", () => {
    const rows = buildSettingsKeyboard(baseStatus);
    const slipHeaderIdx = rows.findIndex(
      (row) => row.length === 1 && row[0]!.text === "-- Slippage --",
    );
    const slipPresetIdx = rows.findIndex((row) =>
      row.some((b) => b.text === "• 10% •"),
    );
    expect(slipHeaderIdx).toBeGreaterThan(-1);
    expect(slipPresetIdx).toBe(slipHeaderIdx + 1);
    const header = rows[slipHeaderIdx]![0]!;
    if (!("callback_data" in header)) {
      throw new Error("Slippage header has no callback_data");
    }
    expect(header.callback_data).toBe(SETTINGS_CALLBACK.noop);
  });

  it("renders a '-- Execution Speed --' inert header row above the Lightning/Fast/Eco buttons", () => {
    const rows = buildSettingsKeyboard(baseStatus);
    const speedHeaderIdx = rows.findIndex(
      (row) => row.length === 1 && row[0]!.text === "-- Execution Speed --",
    );
    const speedPresetIdx = rows.findIndex((row) =>
      row.some((b) => b.text.includes("Lightning")),
    );
    expect(speedHeaderIdx).toBeGreaterThan(-1);
    expect(speedPresetIdx).toBe(speedHeaderIdx + 1);
    const header = rows[speedHeaderIdx]![0]!;
    if (!("callback_data" in header)) {
      throw new Error("Execution Speed header has no callback_data");
    }
    expect(header.callback_data).toBe(SETTINGS_CALLBACK.noop);
  });

  it("renders three inline speed buttons (Lightning, Fast, Eco) in a single row", () => {
    const rows = buildSettingsKeyboard(baseStatus);
    const speedRow = rows.find((row) =>
      row.some((b) => b.text.includes("Lightning")),
    );
    expect(speedRow).toBeDefined();
    expect(speedRow!.length).toBe(3);
    const labels = speedRow!.map((b) => b.text);
    expect(labels).toEqual(["• Lightning •", "Fast", "Eco"]);
  });

  it("marks the active speed preset with bullets", () => {
    const rows = buildSettingsKeyboard({ ...baseStatus, executionTipGwei: 0.15 });
    const labels = flatLabels(rows);
    expect(labels).toContain("Lightning");
    expect(labels).toContain("• Fast •");
    expect(labels).toContain("Eco");
  });

  it("falls back to Lightning when the active tip does not match any preset", () => {
    // Stored custom value from the removed edit wizard. The keyboard
    // must still highlight exactly one preset — Lightning — instead of
    // leaving the user with no visible active selection.
    const rows = buildSettingsKeyboard({ ...baseStatus, executionTipGwei: 2 });
    const labels = flatLabels(rows);
    expect(labels).toContain("• Lightning •");
    // Active markers: slippage preset, speed preset, language preset.
    expect(labels.filter((t) => t.startsWith("• "))).toHaveLength(3);
  });

  it("encodes the slot index in each speed-button callback payload", () => {
    const rows = buildSettingsKeyboard(baseStatus);
    const speedRow = rows.find((row) =>
      row.some((b) => b.text.includes("Lightning")),
    );
    expect(speedRow).toBeDefined();
    const callbacks = speedRow!
      .map((b) => ("callback_data" in b ? b.callback_data : undefined))
      .filter((d): d is string => typeof d === "string");
    expect(callbacks).toEqual([
      encodeSpeedPreset(0),
      encodeSpeedPreset(1),
      encodeSpeedPreset(2),
    ]);
  });

  it("places the speed row above the Buy / Sell Settings row", () => {
    const rows = buildSettingsKeyboard(baseStatus);
    const speedRowIdx = rows.findIndex((row) =>
      row.some((b) => b.text.includes("Lightning")),
    );
    const buySettingsIdx = rows.findIndex((row) =>
      row.some((b) => b.text === "Buy Settings"),
    );
    expect(speedRowIdx).toBeGreaterThan(-1);
    expect(buySettingsIdx).toBeGreaterThan(speedRowIdx);
  });

  it("renders a '-- Language --' inert header row above an active English button", () => {
    const rows = buildSettingsKeyboard(baseStatus);
    const langHeaderIdx = rows.findIndex(
      (row) => row.length === 1 && row[0]!.text === "-- Language --",
    );
    expect(langHeaderIdx).toBeGreaterThan(-1);
    const header = rows[langHeaderIdx]![0]!;
    if (!("callback_data" in header)) {
      throw new Error("Language header has no callback_data");
    }
    expect(header.callback_data).toBe(SETTINGS_CALLBACK.noop);

    const langRow = rows[langHeaderIdx + 1]!;
    expect(langRow.length).toBe(1);
    const englishBtn = langRow[0]!;
    expect(englishBtn.text).toBe("• English •");
    if (!("callback_data" in englishBtn)) {
      throw new Error("English button has no callback_data");
    }
    expect(englishBtn.callback_data).toBe(SETTINGS_CALLBACK.noop);
  });

  it("places the language section below execution speed and above Buy / Sell Settings", () => {
    const rows = buildSettingsKeyboard(baseStatus);
    const speedRowIdx = rows.findIndex((row) =>
      row.some((b) => b.text.includes("Lightning")),
    );
    const langHeaderIdx = rows.findIndex(
      (row) => row.length === 1 && row[0]!.text === "-- Language --",
    );
    const buySettingsIdx = rows.findIndex((row) =>
      row.some((b) => b.text === "Buy Settings"),
    );
    expect(langHeaderIdx).toBeGreaterThan(speedRowIdx);
    expect(buySettingsIdx).toBeGreaterThan(langHeaderIdx);
  });
});
