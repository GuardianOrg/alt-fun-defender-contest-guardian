import { getAssetDisplayName } from "@launchpad/shared";
import { useNavigate } from "react-router";

import styles from "./Sidebar.module.css";
import TerminalSection from "./TerminalSection";
import { CREATE_PATH } from "../../app/routes";
import { useAssets } from "../../hooks/useAssets";
import { cn } from "../../utils/format";
import AssetIcon from "../shared/AssetIcon";
import Button from "../shared/Button";

const MARKET_SKELETON_COUNT = 18;

export default function Sidebar() {
  const navigate = useNavigate();
  const { data: assets } = useAssets();

  return (
    <div className={styles.sidebar}>
      <TerminalSection title="MARKETS" className={styles.marketsPanel} fade="always">
        {assets === undefined
          ? Array.from({ length: MARKET_SKELETON_COUNT }, (_, i) => (
              <div
                key={`market-skeleton-${i}`}
                className={cn(
                  styles.assetRow,
                  i < MARKET_SKELETON_COUNT - 1 && styles.assetRowBorder,
                )}
                aria-busy="true"
              >
                <div
                  className={cn(styles.skeletonBlock, styles.assetLogo)}
                  aria-hidden="true"
                />
                <div className={styles.assetMeta}>
                  <div
                    className={cn(styles.skeletonBlock, styles.skeletonPrice)}
                    aria-hidden="true"
                  />
                  <div
                    className={cn(styles.skeletonBlock, styles.skeletonChange)}
                    aria-hidden="true"
                  />
                </div>
                <div
                  className={cn(styles.skeletonBlock, styles.skeletonPrice)}
                  aria-hidden="true"
                />
              </div>
            ))
          : assets.map((a, i) => {
              return (
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
              );
            })}
      </TerminalSection>

      <div className={styles.ctaSection}>
        <Button
          variant="primary"
          fullWidth
          onClick={() => navigate(CREATE_PATH)}
        >
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
          create an altcoin
        </Button>
      </div>
    </div>
  );
}
