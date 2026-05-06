import { useEffect, useState } from "react";

import styles from "./LandingOverlay.module.css";
import WaveBackground from "./WaveBackground";

const BYPASS_KEY = "altfun-landing-bypass";
const BYPASS_SECRET = "altfun";
const KEY_SEQUENCE = "altfun";

const TWITTER_URL = "https://x.com/altdotfun";
const TELEGRAM_URL = "https://t.me/altdotfun";
const WHITEPAPER_URL = "/whitepaper.pdf";

/**
 * Returns true when the user is allowed to skip the landing page.
 *
 * Bypass routes (any of):
 *   - `?access=altfun` query param (persists via localStorage)
 *   - localStorage flag set by a prior bypass
 *   - `window.__altfunBypass()` in DevTools
 *   - typing "altfun" anywhere on the page
 *
 * `?access=clear` wipes the flag so we can preview the landing page again.
 */
const readBypass = (): boolean => {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  const access = params.get("access");
  if (access === "clear") {
    window.localStorage.removeItem(BYPASS_KEY);
    params.delete("access");
    const qs = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`,
    );
    return false;
  }
  if (access === BYPASS_SECRET) {
    window.localStorage.setItem(BYPASS_KEY, "1");
    params.delete("access");
    const qs = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`,
    );
    return true;
  }
  return window.localStorage.getItem(BYPASS_KEY) === "1";
};

const XIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

const ArrowIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M5 12h14m0 0-6-6m6 6-6 6"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export default function LandingOverlay() {
  const [bypassed, setBypassed] = useState<boolean>(() => readBypass());

  useEffect(() => {
    if (bypassed) return;

    // Type-the-secret backup bypass — useful when the URL trick is forgotten.
    let buffer = "";
    const onKey = (e: KeyboardEvent) => {
      if (e.key.length !== 1) return;
      buffer = (buffer + e.key.toLowerCase()).slice(-KEY_SEQUENCE.length);
      if (buffer === KEY_SEQUENCE) {
        window.localStorage.setItem(BYPASS_KEY, "1");
        setBypassed(true);
      }
    };
    window.addEventListener("keydown", onKey);

    // Programmatic escape hatch for the team in DevTools.
    const w = window as Window & { __altfunBypass?: () => void };
    w.__altfunBypass = () => {
      window.localStorage.setItem(BYPASS_KEY, "1");
      setBypassed(true);
    };

    return () => {
      window.removeEventListener("keydown", onKey);
      delete w.__altfunBypass;
    };
  }, [bypassed]);

  if (bypassed) return null;

  return (
    <div className={styles.overlay} role="dialog" aria-label="Alt Fun landing">
      <WaveBackground />
      <div className={styles.scrim} aria-hidden="true" />
      <div className={styles.vignette} aria-hidden="true" />

      <header className={styles.top}>
        <div className={styles.logo}>
          <img src="/logo.svg" alt="Alt Fun" />
        </div>
        <div className={styles.live}>
          <span className={styles.liveDot} aria-hidden="true" />
          <span>Launching soon</span>
        </div>
      </header>

      <main className={styles.main}>
        <div className={styles.eyebrow}>ALT.FUN&nbsp;&nbsp;//&nbsp;&nbsp;HYPEREVM</div>
        <h1 className={styles.heading}>
          Launch coins
          <span className={styles.headingAccent}>
            backed by <em>Hyperliquid perps</em>
          </span>
        </h1>
        <p className={styles.tag}>Tokens that move even when nobody trades.</p>
        <a
          className={styles.cta}
          href={TWITTER_URL}
          target="_blank"
          rel="noreferrer noopener"
        >
          <XIcon />
          <span>Follow on X</span>
          <span className={styles.ctaArrow} aria-hidden="true">
            <ArrowIcon />
          </span>
        </a>
      </main>

      <footer className={styles.footer}>
        <a
          className={styles.footerLink}
          href={TWITTER_URL}
          target="_blank"
          rel="noreferrer noopener"
        >
          Twitter
        </a>
        <span className={styles.footerSep} aria-hidden="true">
          |
        </span>
        <a
          className={styles.footerLink}
          href={TELEGRAM_URL}
          target="_blank"
          rel="noreferrer noopener"
        >
          Telegram
        </a>
        <span className={styles.footerSep} aria-hidden="true">
          |
        </span>
        <a
          className={styles.footerLink}
          href={WHITEPAPER_URL}
          target="_blank"
          rel="noreferrer noopener"
        >
          Whitepaper
        </a>
      </footer>
    </div>
  );
}
