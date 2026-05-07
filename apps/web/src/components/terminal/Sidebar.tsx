import { useNavigate } from "react-router";

import styles from "./Sidebar.module.css";
import { CREATE_PATH } from "../../app/routes";
import HYPE from "../../assets/Logos/HYPE.svg";
import ETH from "../../assets/Logos/ETH.svg";
import BTC from "../../assets/Logos/BTC.svg";
import SOL from "../../assets/Logos/SOL.svg";
import {
  useAssets,
  usePlatformStats,
  usePairFilters,
} from "../../hooks/useAssets";
import { cn } from "../../utils/format";

const ASSET_LOGOS: Record<string, string> = { HYPE, ETH, BTC, SOL };

export default function Sidebar() {
  const navigate = useNavigate();
  const { data: assets } = useAssets();
  usePlatformStats();
  const { data: filters } = usePairFilters();

  return (
    <div className={styles.sidebar}>
      {/* Asset prices */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>MARKETS</div>
        {assets?.map((a, i) => (
          <div
            key={a.name}
            className={cn(
              styles.assetRow,
              i < assets.length - 1 && styles.assetRowBorder,
            )}
          >
            {ASSET_LOGOS[a.name] && (
              <img
                src={ASSET_LOGOS[a.name]}
                alt=""
                className={styles.assetLogo}
              />
            )}
            <div className={styles.assetMeta}>
              <div className={styles.assetName}>{a.name}</div>
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

      {/* Pair filters */}
      {filters && (
        <div className={styles.section}>
          <div className={styles.pairsHeader}>PAIRS</div>
          {filters.map((f) => (
            <div key={`${f.asset}-${f.direction}`} className={styles.pairRow}>
              <div className={styles.pairDot} style={{ background: f.color }} />
              <span className={styles.pairName}>
                {f.asset} {f.direction === "long" ? "Long" : "Short"}
              </span>
              <span className={styles.pairCount}>{f.count}</span>
            </div>
          ))}
        </div>
      )}

      {/* Launch CTA */}
      <div className={styles.ctaSection}>
        <button
          className={styles.ctaButton}
          onClick={() => navigate(CREATE_PATH)}
        >
          <span className={styles.ctaEmoji}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </span>
          <span className={styles.ctaText}>
            <span className={styles.ctaTitle}>create</span>
            <span className={styles.ctaSub}>launch a levered token</span>
          </span>
        </button>
      </div>
    </div>
  );
}
