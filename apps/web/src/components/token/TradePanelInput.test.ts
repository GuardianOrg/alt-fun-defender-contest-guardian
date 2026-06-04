import { parseUnits } from "viem";
import { describe, expect, it } from "vitest";

import {
  getSellPresetAmount,
  isSellPresetActive,
} from "./tradePanelInputPresets";

describe("sell percent presets", () => {
  it("does not mark zero-balance presets active", () => {
    const computedAmount = getSellPresetAmount(0n, 50, null);

    expect(computedAmount).toEqual({ value: "0", wei: 0n });
    expect(isSellPresetActive("0", computedAmount)).toBe(false);
  });

  it("marks positive matching presets active", () => {
    const computedAmount = getSellPresetAmount(
      parseUnits("100", 18),
      25,
      null,
    );

    expect(computedAmount).toEqual({
      value: "25",
      wei: parseUnits("25", 18),
    });
    expect(isSellPresetActive("25", computedAmount)).toBe(true);
  });

  it("caps sell presets at the current LT buffer limit", () => {
    const computedAmount = getSellPresetAmount(parseUnits("100", 18), 75, {
      maxSellableTokens: 12.5,
    });

    expect(computedAmount).toEqual({
      value: "12.5",
      wei: parseUnits("12.5", 18),
    });
  });
});
