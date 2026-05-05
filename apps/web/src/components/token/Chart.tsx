import { useEffect, useRef, useState } from "react";

import styles from "./Chart.module.css";
import { useChart } from "../../hooks/useChart";
import { useChartData } from "../../hooks/useChartData";
import {
  CHART_INTERVAL_LABELS,
  CHART_INTERVAL_SECONDS,
} from "../../services/api";
import { cn, formatPercent } from "../../utils/format";

import type {
  ChartIntervalSeconds,
  ChartMode,
  ChartTimeframe,
} from "../../services/api";
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
  // Default to a 1m interval — matches what the leader of the space (pump.fun)
  // opens with and gives intra-candle resolution from the moment a token loads.
  // Picking a timeframe switches `mode.kind` to "timeframe" (and the period
  // strip below the chart highlights); picking an interval swings it back.
  const [mode, setMode] = useState<ChartMode>({
    kind: "interval",
    seconds: 60,
  });

  const [intervalMenuOpen, setIntervalMenuOpen] = useState(false);
  const intervalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!intervalMenuOpen) return;

    const onDocClick = (e: MouseEvent) => {
      if (!intervalRef.current?.contains(e.target as Node)) {
        setIntervalMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIntervalMenuOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [intervalMenuOpen]);

  // Graduation progress decomposition (curve-fill % from organic USDC buys vs
  // LT price appreciation). See `Token.organicFilled` / `Token.leverageBoost`.
  // When the API breakdown is degraded `organicFilled` is null — we hide the
  // split rather than silently under-report one bucket.
  const showBreakdown =
    token.organicFilled !== null && token.status !== "graduated";
  const organicPct = token.organicFilled ?? 0;
  const leveragePct = token.leverageBoost;

  const { candles, loading } = useChartData(
    token.address,
    token.ltAddress,
    mode,
  );

  useChart({
    containerRef: chartContainerRef,
    candles,
    mode,
    loading,
  });

  const isEmpty = !loading && candles.length === 0;

  const isTimeframeActive = (tf: ChartTimeframe) =>
    mode.kind === "timeframe" && mode.value === tf;
  const isIntervalActive = mode.kind === "interval";
  const activeIntervalLabel = isIntervalActive
    ? CHART_INTERVAL_LABELS[mode.seconds]
    : null;

  const selectInterval = (seconds: ChartIntervalSeconds) => {
    setMode({ kind: "interval", seconds });
    setIntervalMenuOpen(false);
  };

  return (
    <>
      <div className={styles.toolbar}>
        <div className={styles.intervalPicker} ref={intervalRef}>
          <button
            type="button"
            className={cn(
              styles.intervalBtn,
              styles.intervalPickerBtn,
              isIntervalActive && styles.intervalBtnActive,
            )}
            onClick={() => setIntervalMenuOpen((v) => !v)}
            aria-haspopup="true"
            aria-expanded={intervalMenuOpen}
          >
            <span>{activeIntervalLabel ?? "Interval"}</span>
            <span className={styles.intervalCaret} aria-hidden>
              ▾
            </span>
          </button>
          {intervalMenuOpen && (
            // Plain list of buttons — native button semantics are enough for
            // keyboard + screen-reader users and we don't claim the full
            // listbox/menu ARIA contract (no roving focus / arrow-key model).
            <ul className={styles.intervalMenu}>
              {CHART_INTERVAL_SECONDS.map((seconds) => {
                const active = isIntervalActive && mode.seconds === seconds;
                return (
                  <li key={seconds}>
                    <button
                      type="button"
                      aria-current={active ? "true" : undefined}
                      className={cn(
                        styles.intervalMenuItem,
                        active && styles.intervalMenuItemActive,
                      )}
                      onClick={() => selectInterval(seconds)}
                    >
                      {CHART_INTERVAL_LABELS[seconds]}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {showBreakdown && (
          <>
            <div className={styles.dividerSmall} />

            <div className={styles.decompStats}>
              <span className={styles.decompLabel}>
                buys{" "}
                <span className={styles.decompValueMint}>
                  {formatPercent(organicPct)}
                </span>
              </span>
              <span className={styles.decompLabel}>
                lev{" "}
                <span className={styles.decompAmber}>
                  {formatPercent(leveragePct)}
                </span>
              </span>
            </div>
          </>
        )}

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
      <div className={styles.periodBar}>
        <div className={styles.intervalGroup}>
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.value}
              className={cn(
                styles.intervalBtn,
                isTimeframeActive(tf.value) && styles.intervalBtnActive,
              )}
              onClick={() =>
                setMode({ kind: "timeframe", value: tf.value })
              }
            >
              {tf.label}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
