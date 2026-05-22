import { useEffect, useRef, useState } from "react";

import styles from "./ProgressBar.module.css";
import { cn } from "../../utils/format";

interface ProgressBarProps {
  buyPercent: number;
  leveragePercent: number;
  isShort?: boolean;
  isGraduating?: boolean;
  /**
   * Finished-state override: render a single amber 100% fill and suppress the
   * organic/boost split, pulse, and tooltip.
   */
  isGraduated?: boolean;
  label?: string;
  showLegend?: boolean;
  buyUsd?: string;
  leverageUsd?: string;
  size?: "sm" | "md";
}

export default function ProgressBar({
  buyPercent,
  leveragePercent,
  isShort = false,
  isGraduating = false,
  isGraduated = false,
  label,
  showLegend = false,
  buyUsd,
  leverageUsd,
  size = "sm",
}: ProgressBarProps) {
  const [tooltip, setTooltip] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const [tipPos, setTipPos] = useState({ x: 0, y: 0 });

  const buyPctDisplay = Math.round(buyPercent);
  const levPctDisplay = Math.round(leveragePercent * 10) / 10;

  // Glow intensity is capped so leverage overflow does not compound endlessly.
  const totalFill = Math.min(
    1,
    Math.max(0, (buyPercent + leveragePercent) / 100),
  );

  // Flash only on upward fill changes; the keyed overlay remount restarts CSS.
  const [flashKey, setFlashKey] = useState(0);
  const prevTotalRef = useRef(buyPercent + leveragePercent);
  useEffect(() => {
    const next = buyPercent + leveragePercent;
    if (next > prevTotalRef.current) {
      setFlashKey((k) => k + 1);
    }
    prevTotalRef.current = next;
  }, [buyPercent, leveragePercent]);

  // Finished state: no split or tooltip, with the track clipping the full pill.
  if (isGraduated) {
    return (
      <div className={styles.wrapper}>
        <div
          ref={trackRef}
          className={cn(
            styles.track,
            styles.trackGraduated,
            styles.overflowHidden,
            size === "sm" ? styles.trackSm : styles.trackMd,
          )}
          style={{ "--fill": 1 } as React.CSSProperties}
        >
          <div
            className={cn(styles.buySegment, styles.buySegmentGraduated)}
            style={{ width: "100%" }}
          />
        </div>

        {label && (
          <div className={styles.labelWrap}>
            <span className={styles.labelText}>{label}</span>
          </div>
        )}
      </div>
    );
  }

  // Freeze window: force 100% and let the segment halo pulse outside the track.
  if (isGraduating) {
    return (
      <div className={styles.wrapper}>
        <div
          ref={trackRef}
          className={cn(
            styles.track,
            styles.overflowVisible,
            size === "sm" ? styles.trackSm : styles.trackMd,
          )}
        >
          <div
            className={cn(styles.buySegment, styles.graduatingBar)}
            style={{ width: "100%" }}
          />
        </div>

        {label && (
          <div className={styles.labelWrap}>
            <span className={styles.labelText}>{label}</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={styles.wrapper}>
      <div
        ref={trackRef}
        className={cn(
          styles.track,
          leveragePercent > 0 ? styles.overflowVisible : styles.overflowHidden,
          size === "sm" ? styles.trackSm : styles.trackMd,
        )}
        style={{ "--fill": totalFill } as React.CSSProperties}
        onMouseEnter={() => setTooltip(true)}
        onMouseMove={(e) => setTipPos({ x: e.clientX + 12, y: e.clientY - 60 })}
        onMouseLeave={() => setTooltip(false)}
      >
        <div
          className={cn(
            styles.buySegment,
            leveragePercent <= 0 && styles.buySegmentSolo,
          )}
          style={{ width: `${buyPercent}%` }}
        >
          {/* Remounted on each buy so the one-shot filled-area flash restarts. */}
          {flashKey > 0 && (
            <div
              key={flashKey}
              className={styles.tradeFlash}
              aria-hidden="true"
            />
          )}
        </div>
        {leveragePercent > 0 && (
          <div
            className={cn(
              styles.leverageSegment,
              buyPercent <= 0 && styles.leverageSegmentSolo,
              "leverage-fire",
              isShort ? "leverage-fire-red" : "leverage-fire-mint",
            )}
            style={{
              left: `${buyPercent}%`,
              width: `${leveragePercent}%`,
            }}
          />
        )}
      </div>

      {label && (
        <div className={styles.labelWrap}>
          <span className={styles.labelText}>{label}</span>
        </div>
      )}

      {showLegend && (
        <div className={styles.legend}>
          <div className={styles.legendItem}>
            <div className={cn(styles.legendDot, "bar-glow-mint")} />
            buy pressure{buyUsd && ` · ${buyUsd}`}
          </div>
          <div className={styles.legendItem}>
            <div
              className={cn(
                styles.legendDotLeverage,
                "leverage-fire-dot",
                isShort ? "leverage-fire-dot-red" : "leverage-fire-dot-mint",
              )}
            />
            leverage boost{leverageUsd && ` · ${leverageUsd}`}
          </div>
        </div>
      )}

      {tooltip && (
        <div
          className={styles.tooltip}
          style={{
            left: Math.min(tipPos.x, window.innerWidth - 200),
            top: tipPos.y,
          }}
        >
          <div
            className={
              leveragePercent > 0 ? styles.tooltipRow : styles.tooltipRowLast
            }
          >
            <div className={styles.tooltipDotMint} />
            <span className={styles.tooltipLabel}>buy pressure</span>
            <span className={styles.tooltipValueMint}>{buyPctDisplay}%</span>
          </div>
          {leveragePercent > 0 && (
            <div className={styles.tooltipRowLast}>
              <div
                className={cn(
                  styles.tooltipDotBase,
                  isShort ? styles.dotRed : styles.dotAqua,
                )}
              />
              <span className={styles.tooltipLabel}>leverage boost</span>
              <span className={styles.tooltipValueAmber}>
                {levPctDisplay}%
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
