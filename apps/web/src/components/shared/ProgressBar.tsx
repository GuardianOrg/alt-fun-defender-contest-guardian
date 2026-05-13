import { useEffect, useRef, useState } from "react";

import styles from "./ProgressBar.module.css";
import { cn } from "../../utils/format";

interface ProgressBarProps {
  buyPercent: number;
  leveragePercent: number;
  isShort?: boolean;
  isGraduating?: boolean;
  /**
   * Finished-state override. When true the bar collapses to a single solid
   * amber 100% fill — no organic/boost split, no pulse, no tooltip — which
   * matches `apps/web/AGENTS.md` "If the token is graduated, hide the
   * split entirely". `isGraduating` and `isGraduated` are mutually
   * exclusive lifecycle states (see `Token.status`), but if both arrive
   * as `true` the graduated branch wins and the pulse is suppressed —
   * the bar is finished, not in flight.
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

  // Drives the glow intensity (0..1). Total visible fill, clamped — the
  // leverage segment can extend past 100% as a "boost" overflow, but for
  // the glow we cap at 1 so the effect plateaus instead of compounding
  // unboundedly. Consumed by `.buySegment` / `.leverageSegment` in the
  // module CSS via `calc(var(--fill) * …)` on box-shadow blur + alpha.
  const totalFill = Math.min(
    1,
    Math.max(0, (buyPercent + leveragePercent) / 100),
  );

  // Trade-flash trigger. Any time the visible fill ticks UP we bump a
  // counter that's used as the flash overlay's `key`, forcing React
  // to unmount + remount the element so the one-shot CSS fade
  // re-fires from the start. We deliberately key on increases only —
  // sells (decreases) and override-clears must NOT flash, since the
  // effect signals "a buy just landed". Real WS-driven curve updates
  // and dev-injected `+1 trade` clicks both flow through the same
  // `buyPercent` / `leveragePercent` props, so a single trigger covers
  // both. The flash is rendered only on the active branch below; the
  // effect still runs in graduating / graduated states (hooks have to
  // be unconditional) but `prevTotalRef` stays in sync so a future
  // return to active wouldn't fire a stale flash.
  const [flashKey, setFlashKey] = useState(0);
  const prevTotalRef = useRef(buyPercent + leveragePercent);
  useEffect(() => {
    const next = buyPercent + leveragePercent;
    if (next > prevTotalRef.current) {
      setFlashKey((k) => k + 1);
    }
    prevTotalRef.current = next;
  }, [buyPercent, leveragePercent]);

  // Graduated bars carry no informational split (graduation is a finished
  // lifecycle state, not a live curve in progress), so we skip the
  // mouse-driven tooltip entirely. `overflowHidden` lets the track's
  // 9999px radius clip the right edge of the full-width buy segment into
  // a clean pill — the leverage segment is suppressed in this branch.
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

  // In-flight `graduating` lifecycle. By the time a token reaches this
  // state the bonding curve has already filled to threshold (or the
  // contract has triggered the freeze window) — so the bar is forced to
  // 100% regardless of the live `curveFilled` / `leverageFilled`
  // numbers, and we render a single full-width segment whose GLOW (not
  // the bar itself) fades in and out on a 1.5s cycle. The bar
  // background stays solid mint throughout; only the segment's
  // box-shadow animates between zero and full strength.
  //
  // `overflowVisible` is required here (unlike the graduated branch
  // which uses `overflowHidden`) so the segment's outer halo shadow
  // can extend past the track edges — `overflow: hidden` on the parent
  // clips a child's outer box-shadow even though it doesn't clip its
  // own outer shadow. The segment's full-pill `border-radius` is
  // applied on `.graduatingBar` so the visible shape stays a clean
  // pill without relying on track clipping.
  //
  // Class + keyframe are co-located in `ProgressBar.module.css` (not
  // pulled from `index.css`) so the animation reference can't be lost
  // to CSS-module scoping — see the `feedFlash` precedent in
  // `RightPanel.module.css`.
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
          className={styles.buySegment}
          style={{ width: `${buyPercent}%` }}
        >
          {/* One-shot whitening flash fired every time a buy lands.
           * Nested INSIDE the buy segment (not the track) and sized
           * `inset: 0` so the wash naturally tracks the FILLED portion
           * only — the empty trailing track never gets touched, and
           * as the existing `width 0.3s ease-out` transition grows the
           * bar the wash grows with it.
           *
           * `key={flashKey}` forces a remount on every trigger so the
           * fade restarts from scratch even while a previous run is
           * still in flight — without the key a fast burst of trades
           * would only flash the first one. The `flashKey > 0` gate
           * skips the very first render so initial data arrival
           * doesn't fire a stale flash. `aria-hidden` because this is
           * pure decoration. */}
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
