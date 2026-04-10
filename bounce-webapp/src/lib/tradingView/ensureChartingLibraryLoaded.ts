import { chartingLibraryScriptAbsoluteUrl } from "./tradingViewAssetUrls";

let loadPromise: Promise<void> | null = null;

/**
 * Ensures `charting_library.js` has executed and `window.TradingView.widget` exists.
 * Wallet WebViews sometimes execute the app bundle before deferred head scripts finish;
 * loading here guarantees order relative to widget construction.
 */

export const ensureChartingLibraryLoaded = (): Promise<void> => {
  if (typeof window === "undefined") {
    return Promise.resolve();
  }
  if (window.TradingView?.widget) {
    return Promise.resolve();
  }

  if (!loadPromise) {
    loadPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = chartingLibraryScriptAbsoluteUrl();
      script.async = true;
      script.onload = () => {
        if (window.TradingView?.widget) {
          resolve();
        } else {
          loadPromise = null;
          reject(
            new Error(
              "TradingView global missing after charting_library.js load",
            ),
          );
        }
      };
      script.onerror = () => {
        loadPromise = null;
        reject(new Error("Failed to load charting_library.js"));
      };
      document.head.appendChild(script);
    });
  }

  return loadPromise;
};
