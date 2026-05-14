import { describe, expect, it } from "vitest";

import {
  START_CALLBACK,
  buildStartMenuKeyboard,
} from "../../keyboards/start-menu.js";

describe("buildStartMenuKeyboard", () => {
  it("prefixes the Refresh button with the 🔄 icon to match other refresh buttons", () => {
    const keyboard = buildStartMenuKeyboard("https://example.test/buy-usdc");
    const refreshBtn = keyboard
      .flat()
      .find(
        (b): b is { text: string; callback_data: string } =>
          "callback_data" in b && b.callback_data === START_CALLBACK.refresh,
      );
    expect(refreshBtn).toBeDefined();
    expect(refreshBtn!.text).toBe("🔄 Refresh");
  });
});
