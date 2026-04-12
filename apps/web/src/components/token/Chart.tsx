import { useRef, useState } from "react";

import styles from "./Chart.module.css";
import { useChart } from "../../hooks/useChart";
import { useChartData } from "../../hooks/useChartData";
import { cn, formatPercent } from "../../utils/format";

import type { Token } from "../../services/types";

const INTERVALS = ["1m", "5m", "15m", "1h", "4h"] as const;

interface Props {
  token: Token;
}

export default function Chart({ token }: Props) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [interval, setInterval] = useState<string>("5m");
  const [showOverlay, setShowOverlay] = useState(false);

  const underlyingChg = token.leverage > 0 ? token.leverageBoost / token.leverage : 0;

  const { candles, overlayData, loading } = useChartData(
    token.address,
    interval,
    token.change24h,
    showOverlay,
  );

  useChart({
    containerRef: chartContainerRef,
    candles,
    overlayData,
    loading,
  });

  return (
    <>
      <div className={styles.toolbar}>
        <div className={styles.intervalGroup}>
          {INTERVALS.map((iv) => (
            <button
              key={iv}
              className={cn(
                styles.intervalBtn,
                interval === iv && styles.intervalBtnActive,
              )}
              onClick={() => setInterval(iv)}
            >
              {iv}
            </button>
          ))}
        </div>

        <div className={styles.dividerSmall} />

        <label className={styles.overlayLabel}>
          <div
            className={cn(
              styles.toggleTrack,
              showOverlay && styles.toggleTrackOn,
            )}
            onClick={() => setShowOverlay(!showOverlay)}
          >
            <div
              className={cn(
                styles.toggleDot,
                showOverlay && styles.toggleDotOn,
              )}
            />
          </div>
          <span
            className={cn(
              styles.overlayText,
              showOverlay && styles.overlayTextOn,
            )}
          >
            {token.underlying}
          </span>
        </label>

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
      <div ref={chartContainerRef} className={styles.chartArea} />
    </>
  );
}
