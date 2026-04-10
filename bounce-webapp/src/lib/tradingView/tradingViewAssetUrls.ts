/**
 * TradingView resolves `library_path` and `custom_css_url` inside an iframe; relative URLs
 * can break in in-app browsers. Always pass absolute same-origin URLs.
 */

export const toChartingLibraryFolderUrl = (
  baseUrl: string,
  origin: string,
): string => {
  return new URL("charting_library/", new URL(baseUrl, origin)).href;
};

export const toChartCustomCssUrl = (
  baseUrl: string,
  origin: string,
): string => {
  return new URL("charting_custom/advanced-chart.css", new URL(baseUrl, origin))
    .href;
};

export const toChartingLibraryScriptUrl = (
  baseUrl: string,
  origin: string,
): string => {
  return new URL(
    "charting_library/charting_library.js",
    new URL(baseUrl, origin),
  ).href;
};

export const chartingLibraryFolderAbsoluteUrl = (): string => {
  return toChartingLibraryFolderUrl(
    import.meta.env.BASE_URL,
    typeof window !== "undefined" ? window.location.origin : "",
  );
};

export const chartCustomCssAbsoluteUrl = (): string => {
  return toChartCustomCssUrl(
    import.meta.env.BASE_URL,
    typeof window !== "undefined" ? window.location.origin : "",
  );
};

export const chartingLibraryScriptAbsoluteUrl = (): string => {
  return toChartingLibraryScriptUrl(
    import.meta.env.BASE_URL,
    typeof window !== "undefined" ? window.location.origin : "",
  );
};
