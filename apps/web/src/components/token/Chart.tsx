import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import styles from "./Chart.module.css";
import {
  getTokenOverride,
  subscribeTokenOverrides,
} from "../../dev/devTokenOverrides";
import { useChart } from "../../hooks/useChart";
import { useChartData } from "../../hooks/useChartData";
import { useTokenMarketStats } from "../../hooks/useTokenMarketStats";
import { useWebSocketReconnecting } from "../../hooks/useWebSocketStatus";
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

  const {
    mcapUsd: polledMcapUsd,
    change24h,
    isError: marketDataError,
  } = useTokenMarketStats(address);

  const { candles, loading, liveMcapUsd } = useChartData(
    address,
    token?.ltAddress,
    mode,
    unit,
  );

  // Dev-only mcap override: the `DevSimulator` "pump mcap" / "dump mcap"
  // buttons write into the override store to drive the rolling-number
  // animation without waiting on real on-chain activity. `useTokenMarketStats`
  // already routes the override through its `mcapUsd` field, but we
  // bypass that source below in favour of `liveMcapUsd` for responsiveness,
  // so we have to re-read the override here for the override path to
  // still win. The `import.meta.env.DEV` gate inside the snapshot keeps
  // this dead-code-eliminated in production builds (the subscribe call
  // resolves to a no-op listener set so it stays cheap).
  const overrideMcapUsd = useSyncExternalStore(
    subscribeTokenOverrides,
    () =>
      import.meta.env.DEV ? getTokenOverride(address)?.mcapUsd : undefined,
    () => undefined,
  );

  // Display priority:
  //   1. Dev override (QA-only; must win when set so pump/dump buttons work)
  //   2. Live WS-derived mcap from `useChartData` — updates on every trade
  //      + every 1s LT price tick, matching the chart's price line cadence
  //   3. Polled `/market-data` value — 30s lag fallback for the gap between
  //      mount and the first WS tick (and for tokens with no LT yet)
  const mcapUsd = overrideMcapUsd ?? liveMcapUsd ?? polledMcapUsd;

  useChart({
    containerRef: chartContainerRef,
    candles,
    mode,
    loading,
    unit,
  });

  const isEmpty = !loading && candles.length === 0;
  const reconnecting = useWebSocketReconnecting() || marketDataError || isEmpty;

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

        <div
          className={cn(
            styles.liveIndicator,
            reconnecting && styles.liveIndicatorReconnecting,
          )}
        >
          <div className={styles.liveDot} />
          <span className={styles.liveText}>
            {reconnecting ? "connecting" : "live"}
          </span>
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
            <span className={styles.emptyText}>Fetching chart data...</span>
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
