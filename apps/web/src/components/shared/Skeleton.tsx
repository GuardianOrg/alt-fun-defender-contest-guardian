import type { CSSProperties } from "react";

import styles from "./Skeleton.module.css";
import { cn } from "../../utils/format";

type SkeletonShape = "text" | "circle" | "block";

interface Props {
  /**
   * Visual primitive:
   *  - `text` (default) renders an inline-block bar sized to the surrounding
   *    line-height; pass `width` to control how much of the line it covers.
   *  - `circle` is for avatars / icons; pass `width` only and the height
   *    snaps to match.
   *  - `block` is for arbitrary panels; pass both `width` and `height`.
   */
  shape?: SkeletonShape;
  width?: string | number;
  height?: string | number;
  /**
   * Optional radius override. Defaults to 3px for text/block (matches the
   * project's other surfaces) and 50% for circles.
   */
  radius?: string | number;
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
}

/**
 * Generic loading placeholder. Renders a shimmering bar that matches the
 * mint accent of the rest of the UI. Components should swap in `<Skeleton>`
 * for the *exact* element they're waiting on (same width/height) so the
 * layout doesn't shift when real data lands.
 *
 * Accessibility: each skeleton is `aria-hidden` by default and shouldn't be
 * exposed to screen readers — the parent should set an `aria-busy` / `aria-live`
 * region for that. Pass `ariaLabel` to override.
 */
export default function Skeleton({
  shape = "text",
  width,
  height,
  radius,
  className,
  style,
  ariaLabel,
}: Props) {
  const resolvedHeight =
    shape === "circle" && height === undefined ? width : height;
  const resolvedRadius =
    radius !== undefined ? radius : shape === "circle" ? "50%" : undefined;

  const inlineStyle: CSSProperties = {
    ...(width !== undefined && { width }),
    ...(resolvedHeight !== undefined && { height: resolvedHeight }),
    ...(resolvedRadius !== undefined && { borderRadius: resolvedRadius }),
    ...style,
  };

  return (
    <span
      className={cn(styles.skeleton, styles[shape], className)}
      style={inlineStyle}
      aria-hidden={ariaLabel ? undefined : true}
      aria-label={ariaLabel}
      role={ariaLabel ? "status" : undefined}
    />
  );
}
