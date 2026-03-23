import { useAssets } from '@/hooks/useAssets';
import { cn } from '@/utils/format';
import styles from './AssetTape.module.css';

export default function AssetTape() {
  const { data: assets } = useAssets();
  if (!assets) return null;

  const doubled = [...assets, ...assets];

  return (
    <div className={styles.tape}>
      <div className={styles.liveTag}>
        <div className={styles.liveDot} />
        LIVE
      </div>
      <div className={styles.scrollWrap}>
        <div className={styles.scrollTrack}>
          {doubled.map((a, i) => (
            <div key={`${a.name}-${i}`} className={styles.assetGroup}>
              <div className={styles.assetItem}>
                <span className={styles.assetName}>{a.name}</span>
                <span className={styles.assetPrice}>{a.priceUsd}</span>
                <span
                  className={cn(
                    styles.assetChange,
                    a.change24h >= 0 ? styles.changeMint : styles.changeRed,
                  )}
                >
                  {a.change24h >= 0 ? '+' : ''}
                  {a.change24h}%
                </span>
              </div>
              <span className={styles.separator} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
