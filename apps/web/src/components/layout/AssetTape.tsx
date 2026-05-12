import { getAssetDisplayName } from "@launchpad/shared";

import styles from "./AssetTape.module.css";
import { useAssets } from "../../hooks/useAssets";
import { cn } from "../../utils/format";

/** Repeat assets enough times so one "set" is wider than any viewport. */
const REPEAT_COUNT = 6;

/** Number of skeleton items per set while data is loading. */
const SKELETON_COUNT = 12;

export default function AssetTape() {
  const { data: assets } = useAssets();
  const isLoading = !assets;

  const renderSet = (keyPrefix: string) =>
    assets!.map((a, i) => (
      <div key={`${keyPrefix}-${a.name}-${i}`} className={styles.assetGroup}>
        <div className={styles.assetItem}>
          <span className={styles.assetName}>{getAssetDisplayName(a.name)}</span>
          <span className={styles.assetPrice}>{a.priceUsd}</span>
          <span
            className={cn(
              styles.assetChange,
              a.change24h >= 0 ? styles.changeMint : styles.changeRed,
            )}
          >
            {a.change24h >= 0 ? "+" : ""}
            {a.change24h}%
          </span>
        </div>
        <span className={styles.separator} aria-hidden="true" />
      </div>
    ));

  const renderSkeletonSet = (keyPrefix: string) =>
    Array.from({ length: SKELETON_COUNT }, (_, i) => (
      <div key={`${keyPrefix}-${i}`} className={styles.assetGroup}>
        <div className={styles.assetItem}>
          <span className={cn(styles.skeleton, styles.skeletonName)} />
          <span className={cn(styles.skeleton, styles.skeletonPrice)} />
          <span className={cn(styles.skeleton, styles.skeletonChange)} />
        </div>
        <span className={styles.separator} aria-hidden="true" />
      </div>
    ));

  return (
    <div
      className={styles.tape}
      role="marquee"
      aria-label="Live asset prices"
      aria-busy={isLoading || undefined}
    >
      <div className={styles.scrollWrap}>
        <div className={styles.scrollTrack}>
          {Array.from({ length: REPEAT_COUNT }, (_, setIdx) =>
            isLoading
              ? renderSkeletonSet(`sa${setIdx}`)
              : renderSet(`a${setIdx}`),
          )}
        </div>
        <div className={styles.scrollTrack} aria-hidden="true">
          {Array.from({ length: REPEAT_COUNT }, (_, setIdx) =>
            isLoading
              ? renderSkeletonSet(`sb${setIdx}`)
              : renderSet(`b${setIdx}`),
          )}
        </div>
      </div>
    </div>
  );
}
