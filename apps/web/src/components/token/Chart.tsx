import { useEffect, useRef, useState } from "react";

import styles from "./Chart.module.css";
import { useChart } from "../../hooks/useChart";
import { useChartData } from "../../hooks/useChartData";
import { useTokenMarketStats } from "../../hooks/useTokenMarketStats";
import {
  CHART_INTERVAL_LABELS,
  CHART_INTERVAL_SECONDS,
} from "../../services/api";
import { cn, formatMcapUsd, formatPercent } from "../../utils/format";
import RollingNumber from "../shared/RollingNumber";
import SegmentedButton from "../shared/SegmentedButton";

import type {
  ChartIntervalSeconds,
  ChartMode,
  ChartTimeframe,
  ChartUnit,
} from "../../services/api";
import type { Token } from "../../services/types";

const TIMEFRAMES: { value: ChartTimeframe; label: string }[] = [
  { value: "1d", label: "1D" },
  { value: "5d", label: "5D" },
  { value: "1m", label: "1M" },
];

// Y-axis unit toggle. `MC` is the default — on a 1B-supply launchpad token
// the per-token price is always sub-cent and isn't the primary signal a
// trader is looking at. Mirrors the Dexscreener `MC | Price` toggle.
const UNITS: { value: ChartUnit; label: string }[] = [
  { value: "price", label: "Price" },
  { value: "mcap", label: "Market Cap" },
];

interface Props {
  /** Route param — always available, lets the chart fetch start immediately. */
  address: string;
  /** Resolves later via `useToken`; gates the LT price WS sub and breakdown
   *  toolbar stats but not the initial chart mount/fetch. */
  token: Token | null;
}

export default function Chart({ address, token }: Props) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  // Default to a 1m interval — matches what the leader of the space (pump.fun)
  // opens with and gives intra-candle resolution from the moment a token loads.
  // Picking a timeframe switches `mode.kind` to "timeframe" (and the period
  // strip below the chart highlights); picking an interval swings it back.
  const [mode, setMode] = useState<ChartMode>({
    kind: "interval",
    seconds: 60,
  });
  const [unit, setUnit] = useState<ChartUnit>("mcap");

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

  const { mcapUsd, change24h } = useTokenMarketStats(address);

  const { candles, loading } = useChartData(
    address,
    token?.ltAddress,
    mode,
    unit,
  );

  useChart({
    containerRef: chartContainerRef,
    candles,
    mode,
    loading,
    unit,
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

        <div
          className={styles.intervalGroup}
          role="group"
          aria-label="Chart unit"
        >
          {UNITS.map((u) => {
            const active = unit === u.value;
            return (
              <SegmentedButton
                key={u.value}
                size="slim"
                indicator={false}
                active={active}
                aria-pressed={active}
                onClick={() => setUnit(u.value)}
              >
                {u.label}
              </SegmentedButton>
            );
          })}
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
            <span className={styles.emptyText}>
              No price data available yet
            </span>
          </div>
        )}
        <div ref={chartContainerRef} className={styles.chartCanvas} />
        <span className={styles.axisLabel} aria-hidden>
          {unit === "mcap" ? "Market cap" : "Price"}
        </span>
        <div className={styles.mcapOverlay} aria-label="Market cap">
          <span className={styles.mcapLabel}>Market cap</span>
          <RollingNumber
            className={styles.mcapValue}
            value={mcapUsd}
            format={formatMcapUsd}
            trend="up"
          />
          {change24h !== null && (
            <span
              className={cn(
                styles.mcapChange,
                change24h >= 0 ? styles.mcapChangeUp : styles.mcapChangeDown,
              )}
            >
              {formatPercent(change24h)} 24h
            </span>
          )}
        </div>
      </div>
      <div className={styles.periodBar}>
        <div className={styles.intervalGroup}>
          {TIMEFRAMES.map((tf) => (
            <SegmentedButton
              key={tf.value}
              size="slim"
              indicator={false}
              active={isTimeframeActive(tf.value)}
              onClick={() => setMode({ kind: "timeframe", value: tf.value })}
            >
              {tf.label}
            </SegmentedButton>
          ))}
        </div>
      </div>
    </>
  );
}
