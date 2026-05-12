import type { ButtonHTMLAttributes, ReactNode } from "react";

import styles from "./Chip.module.css";
import { cn } from "../../utils/format";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * Sticky post-action state — applies the mint-confirmed styling that
   * a `:hover` rule on its own can't preserve once the cursor leaves.
   * Used for click-to-copy chips: flip to `success` while the success
   * affordance is on the screen, then back to `false` after the timeout.
   */
  success?: boolean;
  children: ReactNode;
}

/**
 * Small interactive data pill — the "CA: 0x123…" pill, wallet address
 * pill, footer contract pill, etc. Visually it sits halfway between a
 * label and a button: monospace, small, subtle border, becomes mint on
 * hover so the user knows it's interactive. Use for any clickable
 * surface whose primary purpose is to display a value.
 *
 * For square icon-only triggers (gear, close), use `IconButton`. For
 * quick-pick toggle chips (25%, 50%, MAX), use `PresetChip`. For solid
 * call-to-action buttons (Launch, Share, Connect), use `Button`.
 */
export default function Chip({
  success = false,
  className,
  children,
  ...rest
}: Props) {
  return (
    <button
      type="button"
      className={cn(styles.chip, success && styles.chipSuccess, className)}
      {...rest}
    >
      {children}
    </button>
  );
}
