import styles from "./SiteFooter.module.css";

const X_URL = "https://x.com/altdotfun";
const TELEGRAM_URL = "https://t.me/altdotfun";
const WHITEPAPER_URL = "/whitepaper.pdf";
const AUDIT_URL = "/audit.pdf";
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

const ShieldCheckIcon = () => (
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
 * Three groups keep the row scannable in a tight space:
 *   - Left: Whitepaper + Audit Report (icon + label, distinct artifacts)
 *   - Center: Terms / Privacy / DMCA (text-only legal links)
 *   - Right: X + Telegram (icon-only socials)
 * Sticky at the bottom of the viewport on every route — see
 * `SiteFooter.module.css` for the layout/positioning rationale.
 */
export default function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.docs}>
        <a
          className={styles.docLink}
          href={WHITEPAPER_URL}
          target="_blank"
          rel="noreferrer noopener"
        >
          <DocIcon />
          Whitepaper
        </a>
        <span className={styles.divider} aria-hidden="true">
          ·
        </span>
        <a
          className={styles.docLink}
          href={AUDIT_URL}
          target="_blank"
          rel="noreferrer noopener"
        >
          <ShieldCheckIcon />
          Audit Report
        </a>
      </div>

      <div className={styles.legal}>
        <a
          className={styles.legalLink}
          href={TERMS_URL}
          target="_blank"
          rel="noreferrer noopener"
        >
          Terms
        </a>
        <span className={styles.divider} aria-hidden="true">
          ·
        </span>
        <a
          className={styles.legalLink}
          href={PRIVACY_URL}
          target="_blank"
          rel="noreferrer noopener"
        >
          Privacy
        </a>
        <span className={styles.divider} aria-hidden="true">
          ·
        </span>
        <a
          className={styles.legalLink}
          href={DMCA_URL}
          target="_blank"
          rel="noreferrer noopener"
        >
          DMCA
        </a>
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
