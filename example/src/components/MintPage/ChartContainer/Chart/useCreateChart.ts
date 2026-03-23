import { createChart, ColorType, CandlestickSeries } from "lightweight-charts";

import { formatChartPrice } from "./Chart.utils";

export const createConfiguredChart = (
  container: HTMLDivElement,
  colors: {
    text: string;
    grid: string;
  },
) => {
  const chart = createChart(container, {
    autoSize: true,
    layout: {
      background: { type: ColorType.Solid, color: "transparent" },
      textColor: colors.text,
      fontSize: 12,
      attributionLogo: false,
    },
    grid: {
      vertLines: { color: colors.grid },
      horzLines: { color: colors.grid },
    },
    crosshair: {
      mode: 0,
      vertLine: { color: "#6753f1", labelBackgroundColor: "#6753f1" },
      horzLine: { color: "#6753f1", labelBackgroundColor: "#6753f1" },
    },
    rightPriceScale: { visible: true, borderVisible: false },
    leftPriceScale: { visible: false },
    timeScale: {
      visible: true,
      borderVisible: false,
      allowBoldLabels: false,
      timeVisible: true,
      shiftVisibleRangeOnNewBar: true,
      fixLeftEdge: true,
    },
    localization: { locale: navigator.language },
  });

  const candlestickSeries = chart.addSeries(CandlestickSeries, {
    upColor: "#52be60",
    downColor: "#f76960",
    borderVisible: false,
    wickUpColor: "#52be60",
    wickDownColor: "#f76960",
    priceFormat: {
      type: "custom",
      formatter: formatChartPrice,
    },
  });

  return { chart, candlestickSeries };
};
