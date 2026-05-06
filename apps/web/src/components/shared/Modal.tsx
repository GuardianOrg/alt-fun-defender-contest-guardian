import type { ReactNode, MouseEvent } from "react";
import { useCallback, useEffect, useRef } from "react";

import styles from "./Modal.module.css";
import { cn } from "../../utils/format";

interface Props {
  children: ReactNode;
  onClose: () => void;
  ariaLabelledBy?: string;
  /**
   * Where the panel sits inside the viewport.
   * - `center` (default): vertically + horizontally centered.
   * - `top`: pinned near the top of the viewport (Cmd+K-style overlays).
   */
  align?: "center" | "top";
  /**
   * Extra class for the panel surface. Use this to set width / max-height
   * for a specific modal — never to redefine the chrome (border, radius,
   * background, shadow). Those are owned by `Modal` so every popup looks
   * the same; see `apps/web/AGENTS.md` ("Modals & overlays").
   */
  panelClassName?: string;
  /**
   * Hide the auto-rendered close button. Only set this when the panel
   * already includes a `<ModalCloseButton>` inside a custom header, so
   * we don't render two of them.
   */
  hideCloseButton?: boolean;
}

export default function Modal({
  children,
  onClose,
  ariaLabelledBy,
  align = "center",
  panelClassName,
  hideCloseButton = false,
}: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);

  const handleOverlayClick = (e: MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !overlayRef.current) return;

      const focusable = overlayRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    },
    [onClose],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [handleKey]);

  return (
    <div
      ref={overlayRef}
      className={cn(styles.overlay, align === "top" && styles.overlayTop)}
      role="dialog"
      aria-modal="true"
      aria-labelledby={ariaLabelledBy}
      onClick={handleOverlayClick}
    >
      <div className={cn(styles.panel, panelClassName)}>
        {!hideCloseButton && (
          <ModalCloseButton onClose={onClose} className={styles.floatingClose} />
        )}
        {children}
      </div>
    </div>
  );
}

interface CloseButtonProps {
  onClose: () => void;
  className?: string;
}

/**
 * Standard "esc" close badge. Use inside a modal's custom header (then pass
 * `hideCloseButton` to `Modal`); otherwise let `Modal` render its own.
 */
export function ModalCloseButton({ onClose, className }: CloseButtonProps) {
  return (
    <button
      type="button"
      className={cn(styles.closeButton, className)}
      onClick={onClose}
      aria-label="Close (Esc)"
    >
      esc
    </button>
  );
}
