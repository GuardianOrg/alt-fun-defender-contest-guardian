import { useEffect } from "react";
import type { RefObject } from "react";

import styles from "./AddressMenu.module.css";
import { useCopyState } from "../../hooks/useCopyState";
import { cn, shortenAddress } from "../../utils/format";

import type { Address } from "viem";

interface Props {
  address: Address;
  /**
   * The trigger + menu wrapper. Outside-click detection ignores anything
   * inside this ref so that clicking the chip again — to toggle the
   * menu closed — doesn't race the document-level `mousedown` handler
   * and immediately re-open the menu on the trailing click event.
   */
  anchorRef: RefObject<HTMLElement | null>;
  onDisconnect: () => void;
  onClose: () => void;
}

/**
 * Small anchored dropdown that drops below the header wallet chip
 * with two actions: copy the connected address, or disconnect. Not a
 * `Modal` (no scrim, no focus trap) — it's a lightweight overflow
 * menu, so it follows the `SettingsPopup` pattern: click-outside +
 * Esc to close, parent owns open state.
 */
export default function AddressMenu({
  address,
  anchorRef,
  onDisconnect,
  onClose,
}: Props) {
  const { copied, copy } = useCopyState();

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      const anchor = anchorRef.current;
      if (anchor && !anchor.contains(e.target as Node)) onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [anchorRef, onClose]);

  const handleDisconnect = () => {
    onDisconnect();
    onClose();
  };

  return (
    <div className={styles.menu} role="menu">
      <button
        type="button"
        role="menuitem"
        className={cn(styles.item, copied && styles.itemSuccess)}
        onClick={() => copy(address)}
        aria-label={`Copy address ${address}`}
      >
        <span className={styles.address}>{shortenAddress(address)}</span>
        {copied ? (
          <svg
            className={styles.icon}
            aria-hidden="true"
            focusable="false"
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
            className={styles.icon}
            aria-hidden="true"
            focusable="false"
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
      </button>
      <button
        type="button"
        role="menuitem"
        className={cn(styles.item, styles.itemDanger)}
        onClick={handleDisconnect}
      >
        <svg
          className={styles.icon}
          aria-hidden="true"
          focusable="false"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <polyline points="16 17 21 12 16 7" />
          <line x1="21" y1="12" x2="9" y2="12" />
        </svg>
        <span>Disconnect</span>
      </button>
    </div>
  );
}
