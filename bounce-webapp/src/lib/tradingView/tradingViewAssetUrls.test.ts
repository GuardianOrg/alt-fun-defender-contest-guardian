import { describe, expect, it } from "vitest";

import {
  toChartCustomCssUrl,
  toChartingLibraryFolderUrl,
  toChartingLibraryScriptUrl,
} from "./tradingViewAssetUrls";

describe("tradingViewAssetUrls", () => {
  it("resolves absolute URLs from BASE_URL and origin", () => {
    expect(toChartingLibraryFolderUrl("/", "https://bounce.tech")).toBe(
      "https://bounce.tech/charting_library/",
    );
    expect(toChartCustomCssUrl("/", "https://bounce.tech")).toBe(
      "https://bounce.tech/charting_custom/advanced-chart.css",
    );
    expect(toChartingLibraryScriptUrl("/", "https://bounce.tech")).toBe(
      "https://bounce.tech/charting_library/charting_library.js",
    );
  });

  it("includes path prefix when BASE_URL is not root", () => {
    expect(toChartingLibraryFolderUrl("/app/", "https://bounce.tech")).toBe(
      "https://bounce.tech/app/charting_library/",
    );
  });
});
