import type { ButtonHTMLAttributes, ReactNode } from "react";

import styles from "./SegmentedButton.module.css";
import { cn } from "../../utils/format";

type Tone = "mint" | "red" | "neutral";
type Size = "md" | "slim";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** True when this segment is the currently-selected option. */
  active?: boolean;
  /**
   * Tone of the active state. `mint` is the default for positive /
   * primary segments (BUY tab, default tab nav). `red` is for negative
   * segments (SELL tab). `neutral` skips the colored bottom indicator
   * and uses `--txt` instead — for tab bars where no segment carries
   * positional meaning (e.g. trades vs holders).
   */
  tone?: Tone;
  /**
   * Whether to draw the 2px bottom indicator on the active segment.
   * Defaults to true. Set to false in toolbars where active state is
   * already conveyed by the tinted bg alone (chart intervals).
   */
  indicator?: boolean;
  size?: Size;
  /** Stretch to 100% width (for split-toggle grid cells). */
  fluid?: boolean;
  children: ReactNode;
}

/**
 * One segment of a segmented control. Render multiple side-by-side
 * (inside a flex / grid wrapper) for mutually-exclusive options like
 * BUY/SELL, tab bars, and chart-interval pickers.
 *
 * For a single chip with text + icon (e.g. CA address), use `Chip`.
 * For quick-pick toggle chips inside a horizontal row, use
 * `PresetChip`. For solid CTAs, use `Button`.
 */
export default function SegmentedButton({
  active = false,
  tone = "mint",
  indicator = true,
  size = "md",
  fluid = false,
  className,
  children,
  ...rest
}: Props) {
  const activeClass = active
    ? tone === "red"
      ? styles.activeRed
      : tone === "neutral"
        ? styles.activeNeutral
        : styles.activeMint
    : null;
  const indicatorClass =
    tone === "red"
      ? styles.indicatorRed
      : tone === "neutral"
        ? styles.indicatorNeutral
        : styles.indicatorMint;

  return (
    <button
      type="button"
      className={cn(
        styles.seg,
        size === "slim" && styles.slim,
        fluid && styles.fluid,
        activeClass,
        className,
      )}
      {...rest}
    >
      {children}
      {active && indicator && (
        <span className={cn(styles.indicator, indicatorClass)} />
      )}
    </button>
  );
}
