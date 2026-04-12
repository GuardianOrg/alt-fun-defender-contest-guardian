import { useEffect, useRef, useCallback } from "react";

import type { ReactNode, MouseEvent } from "react";

import styles from "./ModalOverlay.module.css";

interface Props {
  children: ReactNode;
  onClose: () => void;
  ariaLabelledBy?: string;
}

export default function ModalOverlay({
  children,
  onClose,
  ariaLabelledBy,
}: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);

  const handleClick = (e: MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  const trapFocus = useCallback((e: KeyboardEvent) => {
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
  }, []);

  useEffect(() => {
    document.addEventListener("keydown", trapFocus);
    return () => document.removeEventListener("keydown", trapFocus);
  }, [trapFocus]);

  return (
    <div
      ref={overlayRef}
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby={ariaLabelledBy}
      onClick={handleClick}
    >
      {children}
    </div>
  );
}
