import type { ChartingLibraryWidgetConstructor } from "../../public/charting_library/charting_library";

declare global {
  interface Window {
    /** TradingView Charting Library global from `/charting_library/charting_library.js`. */
    TradingView: {
      widget: ChartingLibraryWidgetConstructor;
    };
  }
}

export {};
