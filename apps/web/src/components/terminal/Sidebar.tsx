import { getAssetDisplayName, SUPPORTED_UNDERLYING_ASSETS } from "@launchpad/shared";
import { useNavigate } from "react-router";

import styles from "./Sidebar.module.css";
import { CREATE_PATH } from "../../app/routes";
import { useAssets, usePlatformStats } from "../../hooks/useAssets";
import { cn } from "../../utils/format";
import AssetIcon from "../shared/AssetIcon";

// Skeleton row count mirrors the steady-state list so the panel doesn't
// jump (and the CTA below doesn't shift) when real data lands.
const PAIRS_SKELETON_ROWS = SUPPORTED_UNDERLYING_ASSETS.length;

export default function Sidebar() {
  const navigate = useNavigate();
  // We key the loading vs. data branches on React Query's `isLoading`
  // (rather than `data` truthiness) so an error response can't leave the
  // shimmer stuck on screen — `isLoading` flips to false on success or
  // failure, while `data` would stay `undefined` for the lifetime of a
  // failed fetch.
  const { data: assets, isLoading: assetsLoading } = useAssets();
  usePlatformStats();

  return (
    <div className={styles.sidebar}>
      <div className={cn(styles.panel, styles.marketsPanel)}>
        <div className={styles.sectionHeader}>MARKETS</div>
        {assetsLoading
          ? Array.from({ length: PAIRS_SKELETON_ROWS }).map((_, i) => (
              <div
                key={`asset-skel-${i}`}
                className={cn(
                  styles.assetRow,
                  i < PAIRS_SKELETON_ROWS - 1 && styles.assetRowBorder,
                )}
                aria-hidden="true"
              >
                <div
                  className={cn(styles.assetLogo, styles.skeletonCircle)}
                />
                <div className={styles.assetMeta}>
                  <div
                    className={cn(styles.skeletonBlock, styles.skeletonName)}
                  />
                  <div
                    className={cn(styles.skeletonBlock, styles.skeletonChange)}
                  />
                </div>
                <div
                  className={cn(styles.skeletonBlock, styles.skeletonPrice)}
                />
              </div>
            ))
          : assets?.map((a, i) => (
              <div
                key={a.name}
                className={cn(
                  styles.assetRow,
                  i < assets.length - 1 && styles.assetRowBorder,
                )}
              >
                <AssetIcon
                  asset={a.name}
                  size={24}
                  className={styles.assetLogo}
                />
                <div className={styles.assetMeta}>
                  <div className={styles.assetName}>
                    {getAssetDisplayName(a.name)}
                  </div>
                  <div
                    className={cn(
                      styles.assetChange,
                      a.change24h >= 0
                        ? styles.assetChangeUp
                        : styles.assetChangeDown,
                    )}
                  >
                    {a.change24h >= 0 ? "+" : ""}
                    {a.change24h.toFixed(2)}%
                  </div>
                </div>
                <div className={styles.assetPrice}>{a.priceUsd}</div>
              </div>
            ))}
      </div>

      <div className={styles.ctaSection}>
        <button
          className={styles.ctaButton}
          onClick={() => navigate(CREATE_PATH)}
        >
          <span className={styles.ctaEmoji}>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              focusable="false"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </span>
          <span className={styles.ctaText}>
            <span className={styles.ctaTitle}>create an altcoin</span>
          </span>
        </button>
      </div>

      {/* Mirrors the landing page footer (Twitter / Telegram / Whitepaper)
       * so users keep the same socials + docs entrypoint once the landing
       * page is retired at launch. Audit Report (added in #483) stays in
       * the same row. */}
      <div className={styles.footerLinks}>
        <a
          className={styles.footerLink}
          href="/whitepaper.pdf"
          target="_blank"
          rel="noreferrer noopener"
        >
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
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="8" y1="13" x2="16" y2="13" />
            <line x1="8" y1="17" x2="16" y2="17" />
          </svg>
          Whitepaper
        </a>
        <a
          className={styles.footerLink}
          href="/audit.pdf"
          target="_blank"
          rel="noreferrer noopener"
        >
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
            <path d="M9 12l2 2 4-4" />
            <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z" />
          </svg>
          Audit Report
        </a>
      </div>
      <div className={styles.footerSocials}>
        <a
          className={styles.footerIconLink}
          href="https://x.com/altdotfun"
          target="_blank"
          rel="noreferrer noopener"
          aria-label="Follow alt.fun on X (Twitter)"
          title="Twitter"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
          </svg>
        </a>
        <a
          className={styles.footerIconLink}
          href="https://t.me/altdotfun"
          target="_blank"
          rel="noreferrer noopener"
          aria-label="Join alt.fun on Telegram"
          title="Telegram"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.446 1.394c-.16.16-.297.297-.61.297l.213-3.054 5.56-5.022c.242-.213-.054-.334-.373-.121l-6.871 4.326-2.962-.924c-.643-.204-.658-.643.136-.953l11.566-4.458c.538-.196 1.006.128.832.94z" />
          </svg>
        </a>
      </div>
    </div>
  );
}
