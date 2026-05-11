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
    </div>
  );
}
