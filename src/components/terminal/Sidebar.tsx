import { useNavigate } from 'react-router-dom';
import { useAssets, usePlatformStats, usePairFilters } from '@/hooks/useAssets';
import { cn } from '@/utils/format';
import styles from './Sidebar.module.css';

export default function Sidebar() {
  const navigate = useNavigate();
  const { data: assets } = useAssets();
  const { data: stats } = usePlatformStats();
  const { data: filters } = usePairFilters();

  return (
    <div className={styles.sidebar}>
      {/* Asset prices */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          MARKETS
        </div>
        {assets?.map((a, i) => (
          <div
            key={a.name}
            className={cn(
              styles.assetRow,
              i < (assets.length - 1) && styles.assetRowBorder,
            )}
          >
            <div>
              <div className={styles.assetName}>{a.name}</div>
              <div
                className={cn(
                  styles.assetChange,
                  a.change24h >= 0 ? styles.assetChangeUp : styles.assetChangeDown,
                )}
              >
                {a.change24h >= 0 ? '+' : ''}
                {a.change24h.toFixed(2)}%
              </div>
            </div>
            <div className={styles.assetPrice}>{a.priceUsd}</div>
          </div>
        ))}
      </div>

      {/* Platform stats — hidden from UI, data still fetched for later use */}

      {/* Pair filters */}
      {filters && (
        <div className={styles.section}>
          <div className={styles.pairsHeader}>
            PAIRS
          </div>
          {filters.map((f) => (
            <div key={`${f.asset}-${f.direction}`} className={styles.pairRow}>
              <div className={styles.pairDot} style={{ background: f.color }} />
              <span className={styles.pairName}>
                {f.asset} {f.direction === 'long' ? 'Long' : 'Short'}
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
          onClick={() => navigate('/create')}
        >
          <span className={styles.ctaEmoji}>⚡</span>
          <span className={styles.ctaText}>
            <span className={styles.ctaTitle}>
              create
            </span>
            <span className={styles.ctaSub}>launch a levered token</span>
          </span>
        </button>
      </div>
    </div>
  );
}
