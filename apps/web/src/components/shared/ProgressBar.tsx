import { useState, useRef } from "react";

import styles from "./ProgressBar.module.css";
import { cn } from "../../utils/format";

interface ProgressBarProps {
  buyPercent: number;
  leveragePercent: number;
  isShort?: boolean;
  isGraduating?: boolean;
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

  return (
    <div className={styles.wrapper}>
      <div
        ref={trackRef}
        className={cn(
          styles.track,
          leveragePercent > 0 ? styles.overflowVisible : styles.overflowHidden,
          size === "sm" ? styles.trackSm : styles.trackMd,
        )}
        onMouseEnter={() => setTooltip(true)}
        onMouseMove={(e) => setTipPos({ x: e.clientX + 12, y: e.clientY - 60 })}
        onMouseLeave={() => setTooltip(false)}
      >
        <div
          className={cn(
            styles.buySegment,
            "bar-glow-mint",
            isGraduating && styles.graduating,
          )}
          style={{ width: `${buyPercent}%` }}
        />
        {leveragePercent > 0 && (
          <div
            className={cn(
              styles.leverageSegment,
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
