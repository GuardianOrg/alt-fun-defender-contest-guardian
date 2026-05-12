import type { ButtonHTMLAttributes, ReactNode } from "react";

import styles from "./IconButton.module.css";
import { cn } from "../../utils/format";

type IconButtonSize = "md" | "lg";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * Sticky pressed/open state — for icon buttons that toggle a popover
   * (settings cog, filter chevron). Hover and active share the same
   * visual so the popover-open chip doesn't "snap back" when the
   * cursor leaves.
   */
  active?: boolean;
  /**
   * Drop the resting border so the chip blends into a parent toolbar.
   * Hover still draws a border so the affordance is preserved.
   */
  flush?: boolean;
  size?: IconButtonSize;
  /**
   * `aria-label` is required since there is no visible text. Enforced
   * here as a typed, non-optional prop so callers don't forget.
   */
  "aria-label": string;
  children: ReactNode;
}

/**
 * Square, icon-only sibling of `Chip`. Use for gear / close / inline
 * copy where the visible affordance is a single SVG. For text+icon
 * pills, use `Chip`. For full CTAs, use `Button`.
 */
export default function IconButton({
  active = false,
  flush = false,
  size = "md",
  className,
  children,
  ...rest
}: Props) {
  return (
    <button
      type="button"
      className={cn(
        styles.iconBtn,
        size === "lg" && styles.lg,
        flush && styles.flush,
        active && styles.active,
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
