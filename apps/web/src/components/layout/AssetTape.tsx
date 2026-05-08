import { getAssetDisplayName } from "@launchpad/shared";

import styles from "./AssetTape.module.css";
import { useAssets } from "../../hooks/useAssets";
import { cn } from "../../utils/format";

/** Repeat assets enough times so one "set" is wider than any viewport. */
const REPEAT_COUNT = 6;

export default function AssetTape() {
  const { data: assets } = useAssets();

  if (!assets) return null;

  const renderSet = (keyPrefix: string) =>
    assets.map((a, i) => (
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

  return (
    <div className={styles.tape} role="marquee" aria-label="Live asset prices">
      <div className={styles.scrollWrap}>
        <div className={styles.scrollTrack}>
          {Array.from({ length: REPEAT_COUNT }, (_, setIdx) =>
            renderSet(`a${setIdx}`),
          )}
        </div>
        <div className={styles.scrollTrack} aria-hidden="true">
          {Array.from({ length: REPEAT_COUNT }, (_, setIdx) =>
            renderSet(`b${setIdx}`),
          )}
        </div>
      </div>
    </div>
  );
}
