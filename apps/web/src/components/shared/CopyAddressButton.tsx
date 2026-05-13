import { useCopyState } from "../../hooks/useCopyState";
import IconButton from "./IconButton";

import type { MouseEvent, KeyboardEvent } from "react";

interface Props {
  address: string;
  /**
   * Optional per-call sizing override class for the underlying
   * `IconButton`. Only `width` / `height` / `flex-shrink` are
   * appropriate here — never hover / focus / border / background;
   * those come from the primitive and must not be overridden.
   */
  className?: string;
  /**
   * Stop click + keydown from bubbling. Defaults to `true` because
   * almost every place this button lives is inside an interactive
   * row that would otherwise also fire its own navigation handler
   * (Recent Trades feed, position rows, etc.). Set `false` for
   * free-standing copy chips like the profile-page address row.
   */
  stopPropagation?: boolean;
}

/**
 * Inline copy-to-clipboard button for wallet addresses. Wraps the
 * shared `IconButton` with `useCopyState` and the standard copy →
 * check SVG swap, so every address copy affordance in the app
 * (recent trades, trades table, …) renders with the exact same look,
 * 2-second confirmation window, and a11y label format.
 *
 * Resting state inherits the primitive's transparent border/bg so
 * the icon stays visually quiet inside dense rows; hover pulls the
 * standard mint border so the affordance is obvious on mouseover.
 */
export default function CopyAddressButton({
  address,
  className,
  stopPropagation = true,
}: Props) {
  const { copied, copy } = useCopyState();

  const onClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (stopPropagation) e.stopPropagation();
    copy(address);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!stopPropagation) return;
    // Native button activation fires on Enter/Space; stop the same
    // keypress from bubbling into a parent row's keyboard handler.
    if (e.key === "Enter" || e.key === " ") e.stopPropagation();
  };

  return (
    <IconButton
      active={copied}
      onClick={onClick}
      onKeyDown={onKeyDown}
      aria-label={`Copy address ${address}`}
      className={className}
    >
      {copied ? (
        <svg
          aria-hidden="true"
          focusable="false"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg
          aria-hidden="true"
          focusable="false"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </IconButton>
  );
}
