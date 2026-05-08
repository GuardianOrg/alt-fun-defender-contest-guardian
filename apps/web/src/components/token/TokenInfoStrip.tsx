import type { JSX } from "react";

import styles from "./TokenInfoStrip.module.css";
import BTC from "../../assets/Logos/BTC.svg";
import ETH from "../../assets/Logos/ETH.svg";
import HYPE from "../../assets/Logos/HYPE.svg";
import SOL from "../../assets/Logos/SOL.svg";
import { formatUsdOrDash } from "../../utils/format";

import type { Token } from "../../services/types";

const UNDERLYING_LOGOS: Record<string, string> = { HYPE, ETH, BTC, SOL };

interface Props {
  token: Token;
}

interface SocialEntry {
  key: "twitter" | "telegram" | "website";
  url: string;
  label: string;
  icon: JSX.Element;
}

const TwitterIcon = (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
  >
    <path d="M18.244 2H21.5l-7.39 8.443L23 22h-6.797l-5.317-6.96L4.8 22H1.542l7.92-9.045L1 2h6.97l4.806 6.36L18.244 2Zm-1.193 18h1.83L7.07 4H5.108L17.05 20Z" />
  </svg>
);

const TelegramIcon = (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
  >
    <path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z" />
  </svg>
);

const WebsiteIcon = (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="10" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
);

export default function TokenInfoStrip({ token }: Props) {
  const logo = UNDERLYING_LOGOS[token.underlying];
  const direction = token.direction === "short" ? "Short" : "Long";
  const backing = `${token.underlying} ${token.leverage}x ${direction}`;

  // Curate the socials defensively — `socialLinks` is optional on `Token`
  // and individual fields can be empty strings (the create form starts
  // with `""` defaults). Filter those out so we don't render dead links.
  const socials: SocialEntry[] = [];
  const links = token.socialLinks;
  if (links?.twitter) {
    socials.push({
      key: "twitter",
      url: links.twitter,
      label: "Twitter",
      icon: TwitterIcon,
    });
  }
  if (links?.telegram) {
    socials.push({
      key: "telegram",
      url: links.telegram,
      label: "Telegram",
      icon: TelegramIcon,
    });
  }
  if (links?.website) {
    socials.push({
      key: "website",
      url: links.website,
      label: "Website",
      icon: WebsiteIcon,
    });
  }

  return (
    <div className={styles.strip}>
      <div className={styles.statsGroup}>
        <div className={styles.backingStat}>
          {logo && (
            <img
              src={logo}
              alt={token.underlying}
              className={styles.underlyingLogo}
            />
          )}
          <div className={styles.stat}>
            <span className={styles.label}>Backing</span>
            <span className={styles.value}>{backing}</span>
          </div>
        </div>

        <div className={styles.stat}>
          <span className={styles.label}>Vol 24hr</span>
          <span className={styles.value}>
            {formatUsdOrDash(token.volume24h)}
          </span>
        </div>

        <div className={styles.stat}>
          <span className={styles.label}>Leverage Boost</span>
          <span className={styles.value}>
            {`${token.leverageBoost.toFixed(1)}%`}
          </span>
        </div>
      </div>

      <div className={`${styles.stat} ${styles.statEnd}`}>
        <span className={styles.label}>Socials</span>
        {socials.length === 0 ? (
          <span className={styles.valueMuted}>N/A</span>
        ) : (
          <div className={styles.socials}>
            {socials.map((s) => (
              <a
                key={s.key}
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={s.label}
                className={styles.socialLink}
              >
                {s.icon}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
