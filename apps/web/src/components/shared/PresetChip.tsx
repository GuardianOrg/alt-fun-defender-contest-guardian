import type { ButtonHTMLAttributes, ReactNode } from "react";

import styles from "./PresetChip.module.css";
import { cn } from "../../utils/format";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Currently-selected option in the row. Mint border + tinted bg. */
  active?: boolean;
  /**
   * Stretch to fill the row. Used by quick-amount rows where every
   * chip should be equal width (`flex: 1`); leave off for fixed-width
   * preset rows like slippage chips.
   */
  fluid?: boolean;
  children: ReactNode;
}

/**
 * Selectable mini-chip used in horizontal "quick pick" rows: trade
 * input amounts (25/50/75/MAX), seed-buy supply percents, slippage
 * presets, etc. Behaves like a radio in a button group — exactly one
 * is `active` at a time, hover lifts the unselected chips toward
 * `--txt` so the user can preview without committing.
 *
 * For data pills with a value (CA address, wallet), use `Chip`. For
 * mutually-exclusive segmented controls (BUY/SELL, tabs), use
 * `SegmentedButton`. For solid CTAs, use `Button`.
 */
export default function PresetChip({
  active = false,
  fluid = false,
  className,
  children,
  ...rest
}: Props) {
  return (
    <button
      type="button"
      className={cn(
        styles.chip,
        fluid && styles.fluid,
        active && styles.active,
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
