import { getAssetDisplayName } from "@launchpad/shared";
import { useNavigate } from "react-router";

import styles from "./Sidebar.module.css";
import { CREATE_PATH } from "../../app/routes";
import { useAssets, usePlatformStats } from "../../hooks/useAssets";
import { cn } from "../../utils/format";
import AssetIcon from "../shared/AssetIcon";

export default function Sidebar() {
  const navigate = useNavigate();
  const { data: assets } = useAssets();
  usePlatformStats();

  return (
    <div className={styles.sidebar}>
      <div className={cn(styles.panel, styles.marketsPanel)}>
        <div className={styles.sectionHeader}>PAIRS</div>
        {assets?.map((a, i) => (
          <div
            key={a.name}
            className={cn(
              styles.assetRow,
              i < assets.length - 1 && styles.assetRowBorder,
            )}
          >
            <AssetIcon asset={a.name} size={24} className={styles.assetLogo} />
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

      <div className={styles.footerLinks}>
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
    </div>
  );
}
