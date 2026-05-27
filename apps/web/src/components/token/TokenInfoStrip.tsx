import type { JSX } from "react";

import styles from "./TokenInfoStrip.module.css";
import { useLiveTokenVolume24h } from "../../hooks/useLiveTokenVolume24h";
import { formatUsdOrDash } from "../../utils/format";
import Skeleton from "../shared/Skeleton";

import type { Token } from "../../services/types";

interface Props {
  token: Token;
  liveDataPending?: boolean;
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

export default function TokenInfoStrip({
  token,
  liveDataPending = false,
}: Props) {
  // Live 24h volume: 30s polled snapshot from `/api/v1/market-data` plus
  // WS-driven `Zap:Buy`/`Zap:Sell` deltas for trades that have landed since
  // the last poll. Falls back to `token.volume24h` from the initial token
  // fetch only if the live source is degraded.
  const liveVolume24hUsd = useLiveTokenVolume24h(token.address);
  const displayVolume24h = liveVolume24hUsd ?? token.volume24h;

  // Curate the socials defensively — `socialLinks` is optional on `Token`
  // and individual fields can be empty strings (the create form starts
  // with `""` defaults). Filter those out so we don't render dead links.
  //
  // Twitter is special: when the creator didn't submit a profile we still
  // show the X icon, but point it at a search for the contract address so
  // users can find community chatter without leaving the trade page.
  const socials: SocialEntry[] = [];
  const links = token.socialLinks;
  socials.push({
    key: "twitter",
    url:
      links?.twitter ||
      `https://x.com/search?q=${encodeURIComponent(token.address)}`,
    label: links?.twitter ? "Twitter" : "Search X for contract address",
    icon: TwitterIcon,
  });
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
        <div className={styles.stat}>
          <span className={styles.label}>Vol 24hr</span>
          {liveDataPending ? (
            <Skeleton width="4.5rem" height="1rem" />
          ) : (
            <span className={styles.value}>
              {formatUsdOrDash(displayVolume24h)}
            </span>
          )}
        </div>

        <div className={styles.stat}>
          <span className={styles.label}>Leverage Boost</span>
          {liveDataPending ? (
            <Skeleton width="3.5rem" height="1rem" />
          ) : (
            <span className={styles.value}>
              {`${token.leverageBoost.toFixed(1)}%`}
            </span>
          )}
        </div>
      </div>

      <div className={`${styles.stat} ${styles.statEnd}`}>
        <span className={styles.label}>Socials</span>
        <div className={styles.socials}>
          {socials.map((s) => (
            <a
              key={s.key}
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={s.label}
              className={`${styles.socialLink} ${
                s.key === "twitter" ? styles.socialLinkX : ""
              }`}
            >
              {s.icon}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
