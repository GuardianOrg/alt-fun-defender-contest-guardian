import { useRef, useState } from "react";

import DocsMenu from "./DocsMenu";
import styles from "./SiteFooter.module.css";
import DevSimulator from "../dev/DevSimulator";

const X_URL = "https://x.com/altdotfun";
const TELEGRAM_URL = "https://t.me/altdotfun";

const ChevronDownIcon = () => (
  <svg
    className={styles.chevron}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const XIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

const TelegramIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.446 1.394c-.16.16-.297.297-.61.297l.213-3.054 5.56-5.022c.242-.213-.054-.334-.373-.121l-6.871 4.326-2.962-.924c-.643-.204-.658-.643.136-.953l11.566-4.458c.538-.196 1.006.128.832.94z" />
  </svg>
);

/**
 * Thin global footer rendered as the last flex child of the app layout.
 * Two groups keep the row scannable in a tight space:
 *   - Left: a single "Documents" dropdown trigger that consolidates
 *     Whitepaper / Audit Report / Terms / Privacy / DMCA into one popover
 *     to reduce footer noise. See `DocsMenu` for the menu contents.
 *   - Right: X + Telegram (icon-only socials)
 * Sticky at the bottom of the viewport on every route — see
 * `SiteFooter.module.css` for the layout/positioning rationale.
 */
export default function SiteFooter() {
  const [docsMenuOpen, setDocsMenuOpen] = useState(false);
  const docsTriggerWrapRef = useRef<HTMLDivElement>(null);

  return (
    <footer className={styles.footer}>
      <div className={styles.docs}>
        <div ref={docsTriggerWrapRef} className={styles.docsTriggerWrap}>
          <button
            type="button"
            className={styles.docsTrigger}
            onClick={() => setDocsMenuOpen((prev) => !prev)}
            aria-haspopup="menu"
            aria-expanded={docsMenuOpen}
            aria-label="Documents menu"
          >
            <span>Documents</span>
            <ChevronDownIcon />
          </button>
          {docsMenuOpen && (
            <DocsMenu
              anchorRef={docsTriggerWrapRef}
              onClose={() => setDocsMenuOpen(false)}
            />
          )}
        </div>
        {/* Dev-only simulator trigger — returns `null` outside
         * `import.meta.env.DEV` so production renders nothing here. */}
        <DevSimulator />
      </div>

      <div className={styles.socials}>
        <a
          className={styles.iconLink}
          href={X_URL}
          target="_blank"
          rel="noreferrer noopener"
          aria-label="Follow alt.fun on X"
          title="X / Twitter"
        >
          <XIcon />
        </a>
        <a
          className={styles.iconLink}
          href={TELEGRAM_URL}
          target="_blank"
          rel="noreferrer noopener"
          aria-label="Join alt.fun on Telegram"
          title="Telegram"
        >
          <TelegramIcon />
        </a>
      </div>
    </footer>
  );
}
