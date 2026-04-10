import { useEffect, useRef, useState } from "react";

import { useSelector } from "react-redux";

import styles from "./AdvancedChart.module.css";
import { formatChartPrice } from "./AdvancedChart.utils";
import { mintAdvancedChartCustomThemes } from "./advancedChartCustomThemes";
import { buildMintAdvancedChartOverrides } from "./advancedChartWidgetOptions";
import JellyLoader from "../../../../assets/JellyLoader";
import { useThemeContext } from "../../../../contexts/ThemeContextDef";
import useAllUserTrades from "../../../../hooks/Indexer/useTrades";
import { createHyperliquidDatafeed } from "../../../../lib/hyperliquid/tradingView/createHyperliquidDatafeed";
import { ensureChartingLibraryLoaded } from "../../../../lib/tradingView/ensureChartingLibraryLoaded";
import {
  chartCustomCssAbsoluteUrl,
  chartingLibraryFolderAbsoluteUrl,
} from "../../../../lib/tradingView/tradingViewAssetUrls";
import { waitForNonZeroSize } from "../../../../lib/tradingView/waitForNonZeroSize";
import { selectSelectedTargetAsset } from "../../../../state/mintSlice";

import type { IChartingLibraryWidget } from "../../../../../public/charting_library/charting_library";
import type { Trade } from "../../../../hooks/Indexer/useTrades";
import type { ResolutionString } from "../../../../types/chartingLibrary";

const LOADER_SAFETY_MS = 20_000;

const DEFAULT_INTERVAL = "15" as ResolutionString;

const AdvancedChart = ({
  setLivePrice,
  interval = DEFAULT_INTERVAL,
}: {
  setLivePrice: (price: number | null) => void;
  interval?: ResolutionString;
}) => {
  const { theme } = useThemeContext();
  const selectedTargetAsset = useSelector(selectSelectedTargetAsset);
  const symbol = selectedTargetAsset.symbol;

  const { data: tradesData } = useAllUserTrades({
    targetAsset: selectedTargetAsset.symbol,
  });

  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const chartWidgetRef = useRef<IChartingLibraryWidget | null>(null);
  const tradesRef = useRef<Trade[] | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    tradesRef.current = tradesData?.items;
    const widget = chartWidgetRef.current;
    if (!widget) return;
    try {
      widget.activeChart().refreshMarks();
    } catch {
      /* noop */
    }
  }, [tradesData]);

  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container) return;

    let cancelled = false;
    let widget: IChartingLibraryWidget | null = null;
    let disposeDatafeed: (() => void) | null = null;

    setLoading(true);

    const hideLoader = () => {
      if (!cancelled) setLoading(false);
    };

    const safetyTimer = window.setTimeout(hideLoader, LOADER_SAFETY_MS);

    const clearSafetyTimer = () => {
      window.clearTimeout(safetyTimer);
    };

    void (async () => {
      try {
        await ensureChartingLibraryLoaded();
      } catch {
        clearSafetyTimer();
        hideLoader();
        return;
      }
      if (cancelled) return;

      const hasSize = await waitForNonZeroSize(container);
      if (cancelled) return;
      if (!hasSize) {
        clearSafetyTimer();
        hideLoader();
        return;
      }

      const datafeedHandle = createHyperliquidDatafeed({
        onRealtimeBar: (bar) => setLivePrice(bar.close),
        marksContext: {
          getTrades: () => tradesRef.current,
        },
      });
      disposeDatafeed = datafeedHandle.dispose;

      try {
        widget = new window.TradingView.widget({
          symbol,
          interval,
          container,
          library_path: chartingLibraryFolderAbsoluteUrl(),
          datafeed: datafeedHandle.datafeed,
          theme: theme,
          overrides: buildMintAdvancedChartOverrides(theme),
          custom_formatters: {
            priceFormatterFactory: () => ({
              format: (price?: number) => formatChartPrice(price ?? 0),
            }),
          },
          loading_screen: {
            backgroundColor: "transparent",
            foregroundColor: "transparent",
          },
          locale: "en",
          enabled_features: ["iframe_loading_same_origin"],
          disabled_features: [
            "use_localstorage_for_settings",
            "edit_buttons_in_legend",
            "header_compare",
            "header_fullscreen_button",
            "header_indicators",
            "header_screenshot",
            "header_settings",
            "header_symbol_search",
            "header_quick_search",
            "symbol_search_hot_key",
            "popup_hints",
            "source_selection_markers",
            "legend_widget",
          ],
          autosize: true,
          custom_css_url: chartCustomCssAbsoluteUrl(),
          custom_themes: mintAdvancedChartCustomThemes,
        });
      } catch {
        datafeedHandle.dispose();
        disposeDatafeed = null;
        clearSafetyTimer();
        hideLoader();
        return;
      }

      if (cancelled) {
        widget.remove();
        datafeedHandle.dispose();
        disposeDatafeed = null;
        return;
      }

      chartWidgetRef.current = widget;

      const onReady = () => {
        clearSafetyTimer();
        hideLoader();
      };

      widget.onChartReady(onReady);
      widget.subscribe("chart_loaded", onReady);
    })();

    return () => {
      cancelled = true;
      clearSafetyTimer();
      chartWidgetRef.current = null;
      widget?.remove();
      disposeDatafeed?.();
      setLivePrice(null);
    };
  }, [symbol, interval, theme, setLivePrice]);

  return (
    <div className={styles.wrapper}>
      {loading ? (
        <div className={styles.loader} data-testid="advanced-chart-loader">
          <JellyLoader />
        </div>
      ) : null}
      <div ref={chartContainerRef} className={styles.chart} />
    </div>
  );
};

export default AdvancedChart;
