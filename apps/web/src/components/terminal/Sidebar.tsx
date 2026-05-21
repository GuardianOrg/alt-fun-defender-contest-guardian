import {
  getAssetDisplayName,
  SUPPORTED_UNDERLYING_ASSETS,
} from "@launchpad/shared";
import { useNavigate } from "react-router";

import styles from "./Sidebar.module.css";
import { CREATE_PATH } from "../../app/routes";
import { useAssets } from "../../hooks/useAssets";
import { cn } from "../../utils/format";
import AssetIcon from "../shared/AssetIcon";
import Button from "../shared/Button";

import type { Asset } from "../../services/types";

type StaticMarketRow = Pick<Asset, "name">;
type MarketRow = Asset | StaticMarketRow;

function hasMarketData(row: MarketRow): row is Asset {
  return "priceUsd" in row;
}

export default function Sidebar() {
  const navigate = useNavigate();
  const { data: assets, isLoading: assetsLoading } = useAssets();
  const marketRows: readonly MarketRow[] =
    assets ?? SUPPORTED_UNDERLYING_ASSETS.map((name) => ({ name }));

  return (
    <div className={styles.sidebar}>
      <div className={cn(styles.panel, styles.marketsPanel)}>
        <div className={styles.sectionHeader}>MARKETS</div>
        {marketRows.map((a, i) => {
          const marketDataLoaded = !assetsLoading && hasMarketData(a);
          return (
            <div
              key={a.name}
              className={cn(
                styles.assetRow,
                i < marketRows.length - 1 && styles.assetRowBorder,
              )}
              aria-busy={!marketDataLoaded || undefined}
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
                {marketDataLoaded ? (
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
                ) : (
                  <div
                    className={cn(styles.skeletonBlock, styles.skeletonChange)}
                    aria-hidden="true"
                  />
                )}
              </div>
              {marketDataLoaded ? (
                <div className={styles.assetPrice}>{a.priceUsd}</div>
              ) : (
                <div
                  className={cn(styles.skeletonBlock, styles.skeletonPrice)}
                  aria-hidden="true"
                />
              )}
            </div>
          );
        })}
      </div>

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
