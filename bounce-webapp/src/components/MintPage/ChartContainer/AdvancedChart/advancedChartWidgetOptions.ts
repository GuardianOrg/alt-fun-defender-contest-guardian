import { chartColors } from "./AdvancedChart.utils";

import type { WidgetOverrides } from "../../../../../public/charting_library/charting_library";

/** Brand accent colors aligned with `chartColors` in `AdvancedChart.utils.ts`. */
const CROSSHAIR = "#6753f1";

const CANDLE_UP = "#52be60";

const CANDLE_DOWN = "#f76960";

/**
 * Visual overrides for mint branding: transparent pane, grid/text from theme,
 * purple crosshair, green/red candles.
 */
export function buildMintAdvancedChartOverrides(
  theme: "light" | "dark",
): Partial<WidgetOverrides> {
  const colors = chartColors({ theme });

  return {
    "paneProperties.backgroundType": "solid",
    "paneProperties.background": "rgba(0, 0, 0, 0)",
    "paneProperties.vertGridProperties.color": colors.grid,
    "paneProperties.horzGridProperties.color": colors.grid,
    "paneProperties.crossHairProperties.color": CROSSHAIR,
    "paneProperties.crossHairProperties.width": 1,
    "scalesProperties.textColor": colors.text,
    "scalesProperties.fontSize": 12,
    "scalesProperties.lineColor": "rgba(0, 0, 0, 0)",
    "scalesProperties.crosshairLabelBgColorLight": CROSSHAIR,
    "scalesProperties.crosshairLabelBgColorDark": CROSSHAIR,
    "mainSeriesProperties.candleStyle.upColor": CANDLE_UP,
    "mainSeriesProperties.candleStyle.downColor": CANDLE_DOWN,
    "mainSeriesProperties.candleStyle.wickUpColor": CANDLE_UP,
    "mainSeriesProperties.candleStyle.wickDownColor": CANDLE_DOWN,
    "mainSeriesProperties.candleStyle.drawBorder": false,
  };
}
