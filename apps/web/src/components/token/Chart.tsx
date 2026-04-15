import { useRef, useState } from "react";

import styles from "./Chart.module.css";
import { useChart } from "../../hooks/useChart";
import { useChartData } from "../../hooks/useChartData";
import { cn, formatPercent } from "../../utils/format";

import type { ChartTimeframe } from "../../services/api";
import type { Token } from "../../services/types";

const TIMEFRAMES: { value: ChartTimeframe; label: string }[] = [
  { value: "1d", label: "1D" },
  { value: "5d", label: "5D" },
  { value: "1m", label: "1M" },
];

interface Props {
  token: Token;
}

export default function Chart({ token }: Props) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [timeframe, setTimeframe] = useState<ChartTimeframe>("1d");

  const underlyingChg = token.leverage > 0 ? token.leverageBoost / token.leverage : 0;

  const { candles, loading } = useChartData(token.address, timeframe);

  useChart({
    containerRef: chartContainerRef,
    candles,
    timeframe,
    loading,
  });

  const isEmpty = !loading && candles.length === 0;

  return (
    <>
      <div className={styles.toolbar}>
        <div className={styles.intervalGroup}>
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.value}
              className={cn(
                styles.intervalBtn,
                timeframe === tf.value && styles.intervalBtnActive,
              )}
              onClick={() => setTimeframe(tf.value)}
            >
              {tf.label}
            </button>
          ))}
        </div>

        <div className={styles.dividerSmall} />

        <div className={styles.decompStats}>
          <span className={styles.decompLabel}>
            buys{" "}
            <span
              className={
                token.buyMomentum >= 0
                  ? styles.decompValueMint
                  : styles.decompValueRed
              }
            >
              {formatPercent(token.buyMomentum)}
            </span>
          </span>
          <span className={styles.decompLabel}>
            lev{" "}
            <span className={styles.decompAmber}>
              {formatPercent(token.leverageBoost)}
            </span>
            <span className={styles.decompDetail}>
              ({formatPercent(underlyingChg)}×{token.leverage})
            </span>
          </span>
        </div>

        <div className={styles.liveIndicator}>
          <div className={styles.liveDot} />
          <span className={styles.liveText}>live</span>
        </div>
      </div>
      <div className={styles.chartArea}>
        {loading && (
          <div className={styles.loadingState}>
            <div className={styles.spinner} />
          </div>
        )}
        {isEmpty && (
          <div className={styles.emptyState}>
            <span className={styles.emptyText}>No price data available yet</span>
          </div>
        )}
        <div ref={chartContainerRef} className={styles.chartCanvas} />
      </div>
    </>
  );
}
