import { useRef, useState } from "react";

import DocsMenu from "./DocsMenu";
import styles from "./SiteFooter.module.css";
import DevSimulator from "../dev/DevSimulator";

const X_URL = "https://x.com/altdotfun";
const TELEGRAM_URL = "https://t.me/altdotfun";
const DOCS_URL = "https://docs.alt.fun";
const GITHUB_URL = "https://github.com/alt-fun";

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

const GitBookIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M10.802 17.77a.703.703 0 1 1-.002 1.406.703.703 0 0 1 .002-1.406m11.024-4.347a.703.703 0 1 1 .001-1.406.703.703 0 0 1-.001 1.406m0-2.876a2.176 2.176 0 0 0-2.174 2.174c0 .233.039.465.115.691l-7.181 3.823a2.165 2.165 0 0 0-1.784-.937c-.829 0-1.584.475-1.95 1.216l-6.451-3.402c-.682-.358-1.192-1.48-1.138-2.502.028-.533.212-.947.493-1.107.178-.1.392-.092.62.027l.042.023c1.71.9 7.304 3.847 7.54 3.956.363.169.565.237 1.185-.057l11.564-6.014c.17-.064.368-.227.368-.474 0-.342-.354-.477-.355-.477-.658-.315-1.669-.788-2.655-1.25-2.108-.987-4.497-2.105-5.546-2.655-.906-.474-1.635-.074-1.765.006l-.252.125C7.78 6.048 1.46 9.178 1.1 9.397.457 9.789.058 10.57.006 11.539c-.08 1.537.703 3.14 1.824 3.727l6.822 3.518a2.175 2.175 0 0 0 2.15 1.862 2.177 2.177 0 0 0 2.173-2.14l7.514-4.073c.38.298.853.461 1.337.461A2.176 2.176 0 0 0 24 12.72a2.176 2.176 0 0 0-2.174-2.174" />
  </svg>
);

const GitHubIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 .5C5.648.5.5 5.648.5 12c0 5.082 3.292 9.387 7.86 10.91.575.106.785-.25.785-.554 0-.273-.01-.998-.016-1.96-3.197.694-3.872-1.541-3.872-1.541-.523-1.328-1.278-1.682-1.278-1.682-1.044-.714.08-.7.08-.7 1.155.082 1.763 1.187 1.763 1.187 1.027 1.76 2.694 1.252 3.351.957.103-.744.402-1.253.731-1.541-2.553-.29-5.238-1.277-5.238-5.685 0-1.256.45-2.283 1.186-3.088-.119-.291-.514-1.46.112-3.045 0 0 .967-.31 3.17 1.18a11.02 11.02 0 0 1 2.886-.388c.979.005 1.965.132 2.886.388 2.202-1.49 3.168-1.18 3.168-1.18.628 1.585.233 2.754.114 3.045.74.805 1.184 1.832 1.184 3.088 0 4.42-2.69 5.392-5.252 5.676.413.355.78 1.057.78 2.132 0 1.54-.014 2.78-.014 3.158 0 .306.208.665.79.552C20.213 21.384 23.5 17.082 23.5 12 23.5 5.648 18.352.5 12 .5z" />
  </svg>
);

/**
 * Thin global footer rendered as the last flex child of the app layout.
 * Two groups keep the row scannable in a tight space:
 *   - Left: a single "Documents" dropdown trigger that consolidates
 *     Whitepaper / audit reports / Terms / Privacy / DMCA into one popover
 *     to reduce footer noise. See `DocsMenu` for the menu contents.
 *   - Right: GitBook (docs) + GitHub (source) + X + Telegram (icon-only socials)
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
          href={DOCS_URL}
          target="_blank"
          rel="noreferrer noopener"
          aria-label="Read the alt.fun docs on GitBook"
          title="Docs"
        >
          <GitBookIcon />
        </a>
        <a
          className={styles.iconLink}
          href={GITHUB_URL}
          target="_blank"
          rel="noreferrer noopener"
          aria-label="Visit alt.fun on GitHub"
          title="GitHub"
        >
          <GitHubIcon />
        </a>
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
