import { useEffect } from "react";
import type { RefObject } from "react";

import styles from "./DocsMenu.module.css";
import { cn } from "../../utils/format";

interface Props {
  /**
   * Trigger + menu wrapper. Outside-click detection ignores anything
   * inside this ref so clicking the trigger again to toggle the menu
   * closed doesn't race the document-level `mousedown` handler and
   * immediately re-open the menu on the trailing click event.
   */
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
}

const WHITEPAPER_URL = "/whitepaper.pdf";
// Newest first — the top row is the review users should read as current.
// `/audit-phage-security.pdf` used to live at `/audit.pdf`; that path is
// 301'd in `public/_redirects` for externally shared links.
const AUDITS = [
  { firm: "Guardian", date: "Jul 2026", url: "/audit-guardian.pdf" },
  { firm: "Phage Security", date: "May 2026", url: "/audit-phage-security.pdf" },
] as const;
// Legal docs are rendered from `apps/web/legal-source/*.md` by
// `scripts/build-legal-docs.mjs` and copied through Vite's `public/`
// pipeline. Keep these constants in sync with the output filenames if
// the source files are ever renamed.
const TERMS_URL = "/altfun-terms-of-use.html";
const PRIVACY_URL = "/altfun-privacy-notice.html";
const DMCA_URL = "/altfun-dmca-policy.html";

const DocIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="8" y1="13" x2="16" y2="13" />
    <line x1="8" y1="17" x2="16" y2="17" />
  </svg>
);

const CheckBadgeIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M9 12l2 2 4-4" />
    <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z" />
  </svg>
);

/**
 * Anchored popover triggered from the footer "Documents" button. Drops
 * upward (the footer is pinned to the bottom of the viewport, so a
 * downward menu would be clipped). Groups the document links into two
 * visual sections separated by a divider:
 *   - Product docs: Whitepaper, one row per audit — icon + label, brighter
 *   - Legal docs: Terms, Privacy, DMCA — text-only, dimmer
 *
 * Audits stay flat rather than nesting behind a submenu so every document
 * is one click deep; the trailing date is what distinguishes the rows.
 *
 * Follows the same lightweight popover pattern as `AddressMenu`:
 * outside-click + Esc close, parent owns open state, no scrim, no
 * focus trap.
 */
export default function DocsMenu({ anchorRef, onClose }: Props) {
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

  return (
    <div className={styles.menu} role="menu">
      <a
        role="menuitem"
        className={styles.item}
        href={WHITEPAPER_URL}
        target="_blank"
        rel="noreferrer noopener"
        onClick={onClose}
      >
        <DocIcon />
        <span className={styles.label}>Whitepaper</span>
      </a>
      {AUDITS.map((audit) => (
        <a
          key={audit.url}
          role="menuitem"
          className={styles.item}
          href={audit.url}
          target="_blank"
          rel="noreferrer noopener"
          onClick={onClose}
        >
          <CheckBadgeIcon />
          <span className={styles.label}>{audit.firm} Audit</span>
          <span className={styles.meta}>{audit.date}</span>
        </a>
      ))}

      <div className={styles.separator} role="separator" />

      <a
        role="menuitem"
        className={cn(styles.item, styles.itemLegal)}
        href={TERMS_URL}
        target="_blank"
        rel="noreferrer noopener"
        onClick={onClose}
      >
        <span className={styles.label}>Terms</span>
      </a>
      <a
        role="menuitem"
        className={cn(styles.item, styles.itemLegal)}
        href={PRIVACY_URL}
        target="_blank"
        rel="noreferrer noopener"
        onClick={onClose}
      >
        <span className={styles.label}>Privacy</span>
      </a>
      <a
        role="menuitem"
        className={cn(styles.item, styles.itemLegal)}
        href={DMCA_URL}
        target="_blank"
        rel="noreferrer noopener"
        onClick={onClose}
      >
        <span className={styles.label}>DMCA</span>
      </a>
    </div>
  );
}
