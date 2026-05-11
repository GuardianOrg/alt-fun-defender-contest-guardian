import { useEffect, useState } from "react";

import styles from "./PrimerModal.module.css";
import AltFunLogo from "../../assets/AltFunLogo/AltFunLogo";
import Button from "../shared/Button";
import Modal from "../shared/Modal";

const PRIMER_KEY = "altfun-primer-seen";
const LANDING_BYPASS_KEY = "altfun-landing-bypass";
const LANDING_BYPASS_EVENT = "altfun-landing-bypassed";

// Static legal docs rendered from `apps/web/legal-source/*.md` by
// `scripts/build-legal-docs.mjs`. Mirror the URLs in `SiteFooter.tsx`
// — if either set drifts, the button copy below will link to a page
// that doesn't exist.
const TERMS_URL = "/altfun-terms-of-use.html";
const PRIVACY_URL = "/altfun-privacy-notice.html";
const DMCA_URL = "/altfun-dmca-policy.html";

const readPrimerSeen = (): boolean => {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(PRIMER_KEY) === "1";
  } catch {
    // Privacy mode / disabled storage — assume seen so we don't pester
    // a user we can't remember.
    return true;
  }
};

const readLandingBypassed = (): boolean => {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(LANDING_BYPASS_KEY) === "1";
  } catch {
    return false;
  }
};

const markPrimerSeen = () => {
  try {
    window.localStorage.setItem(PRIMER_KEY, "1");
  } catch {
    // best-effort
  }
};

/**
 * One-time welcome card explaining alt.fun's core mechanic to new users.
 *
 * Visibility rules:
 *   - Only shown after the user has cleared the pre-launch landing gate
 *     (`altfun-landing-bypass === "1"`). Otherwise the primer would mount
 *     behind `LandingOverlay`'s full-screen wireframe and an `esc` press
 *     would silently dismiss something the user never saw.
 *   - Only shown once per browser (`altfun-primer-seen === "1"` after the
 *     user clicks Continue / closes the modal).
 *   - Listens for the `altfun-landing-bypassed` window event so the primer
 *     can flip on the moment `LandingOverlay` accepts the secret in the
 *     same tab (storage events only fire across tabs).
 */
export default function PrimerModal() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const evaluate = () => {
      if (readLandingBypassed() && !readPrimerSeen()) setOpen(true);
    };
    evaluate();
    window.addEventListener(LANDING_BYPASS_EVENT, evaluate);
    return () => window.removeEventListener(LANDING_BYPASS_EVENT, evaluate);
  }, []);

  if (!open) return null;

  const handleContinue = () => {
    markPrimerSeen();
    setOpen(false);
  };

  // No-op `onClose` + `hideCloseButton` makes this a forced-acknowledgement
  // modal: esc and overlay clicks are neutered, and the user can only
  // dismiss via the Continue button below. This is intentional — clicking
  // Continue is what records consent for the linked Terms / Privacy /
  // age-gate copy beneath the button.
  return (
    <Modal
      onClose={() => {}}
      ariaLabelledBy="primer-modal-title"
      panelClassName={styles.modal}
      hideCloseButton
    >
      <div className={styles.body}>
        <AltFunLogo size={72} className={styles.logo} />
        <h1 id="primer-modal-title" className={styles.heading}>
          Welcome to alt.fun
        </h1>
        <div className={styles.copy}>
          <p>
            Every token on alt.fun is paired with a tokenized Hyperliquid
            perp.
          </p>
          <p>
            Your token&apos;s price moves from trading on the curve and from
            the underlying asset moving in your direction.
          </p>
          <p>Tokens can pump even when nobody&apos;s buying.</p>
        </div>
        <Button onClick={handleContinue} size="lg" fullWidth>
          Continue
        </Button>
        <span className={styles.disclaimer}>
          By clicking, you agree to the{" "}
          <a
            className={styles.disclaimerLink}
            href={TERMS_URL}
            target="_blank"
            rel="noreferrer noopener"
          >
            Terms of Use
          </a>
          ,{" "}
          <a
            className={styles.disclaimerLink}
            href={PRIVACY_URL}
            target="_blank"
            rel="noreferrer noopener"
          >
            Privacy Notice
          </a>
          , and{" "}
          <a
            className={styles.disclaimerLink}
            href={DMCA_URL}
            target="_blank"
            rel="noreferrer noopener"
          >
            DMCA Policy
          </a>
          , and confirm you are over 18 years old.
        </span>
      </div>
    </Modal>
  );
}
