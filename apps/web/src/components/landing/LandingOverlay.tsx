import { useEffect, useState, type ReactNode } from "react";

import styles from "./LandingOverlay.module.css";
import WaveBackground from "./WaveBackground";

// Bumped the version suffix when the access secret changed so any browser
// that had cleared the previous (easily-guessed) gate is forced to re-enter
// the new one. PrimerModal imports these constants — keep both in sync.
export const LANDING_BYPASS_KEY = "altfun-landing-bypass:v2";
export const LANDING_BYPASS_EVENT = "altfun-landing-bypassed:v2";

// Pre-launch access token shared with the team out-of-band. Rotated by
// changing this constant + the `:v…` suffix on `LANDING_BYPASS_KEY` above
// (which expires already-bypassed sessions). The repo is private so a
// hardcoded constant is fine; the threat model is "random visitor guesses
// the URL", not "team member with repo access".
const BYPASS_SECRET = "b9Kq7vXz3RmPnYwLfT2J";

const X_URL = "https://x.com/altdotfun";
const TELEGRAM_URL = "https://t.me/altdotfun";
const WHITEPAPER_URL = "/whitepaper.pdf";

const safeGetItem = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const safeSetItem = (key: string, value: string) => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // best-effort — privacy mode / disabled storage
  }
};

const safeRemoveItem = (key: string) => {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // best-effort
  }
};

const persistBypass = () => {
  safeSetItem(LANDING_BYPASS_KEY, "1");
  window.dispatchEvent(new Event(LANDING_BYPASS_EVENT));
};

/**
 * Returns true when the user is allowed to skip the landing page.
 *
 * Bypass routes (any of):
 *   - `?access=<BYPASS_SECRET>` query param (persists via localStorage)
 *   - localStorage flag set by a prior bypass
 *   - `window.__altfunBypass()` in DevTools (team escape hatch)
 *
 * `?access=clear` wipes the flag so we can preview the landing page again.
 */
const readBypass = (): boolean => {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  const access = params.get("access");
  if (access === "clear") {
    safeRemoveItem(LANDING_BYPASS_KEY);
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
    persistBypass();
    params.delete("access");
    const qs = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`,
    );
    return true;
  }
  return safeGetItem(LANDING_BYPASS_KEY) === "1";
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

/**
 * Pre-launch access gate. While the gate is up the children — including all
 * app providers (Privy, Wagmi, Redux, the router) — are not mounted at all,
 * so a casual visitor can't reach the app via Inspect-Element + delete-node.
 * Once the user has cleared the gate (URL secret, localStorage flag, or the
 * DevTools `window.__altfunBypass()` escape hatch) the children mount.
 */
export default function LandingOverlay({ children }: { children: ReactNode }) {
  const [bypassed, setBypassed] = useState<boolean>(() => readBypass());

  useEffect(() => {
    if (bypassed) return;

    const w = window as Window & { __altfunBypass?: () => void };
    w.__altfunBypass = () => {
      persistBypass();
      setBypassed(true);
    };

    return () => {
      delete w.__altfunBypass;
    };
  }, [bypassed]);

  if (bypassed) return <>{children}</>;

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
        <h1 className={styles.heading}>
          Launch coins
          <span className={styles.headingAccent}>
            backed by <em>Hyperliquid perps</em>
          </span>
        </h1>
        <p className={styles.tag}>Tokens that move even when nobody trades.</p>
        <a
          className={styles.cta}
          href={X_URL}
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
          href={X_URL}
          target="_blank"
          rel="noreferrer noopener"
        >
          X
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
