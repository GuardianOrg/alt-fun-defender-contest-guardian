import type { KeyboardEvent } from "react";

import { useRef } from "react";

import styles from "./AssetTape.module.css";
import { useAssets } from "../../hooks/useAssets";
import { cn } from "../../utils/format";

export default function AssetTape() {
  const { data: assets } = useAssets();
  const scrollRef = useRef<HTMLDivElement>(null);

  if (!assets) return null;

  const doubled = [...assets, ...assets];

  const handleKeyDown = (e: KeyboardEvent) => {
    if (!scrollRef.current) return;
    const scrollAmount = 150;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      scrollRef.current.scrollLeft += scrollAmount;
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      scrollRef.current.scrollLeft -= scrollAmount;
    }
  };

  return (
    <div
      className={styles.tape}
      role="marquee"
      aria-label="Live asset prices"
    >
      <div className={styles.liveTag} aria-hidden="true">
        <div className={styles.liveDot} />
        LIVE
      </div>
      <div
        ref={scrollRef}
        className={styles.scrollWrap}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        aria-label="Asset price ticker — use arrow keys to scroll"
      >
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
                  {a.change24h >= 0 ? "+" : ""}
                  {a.change24h}%
                </span>
              </div>
              <span className={styles.separator} aria-hidden="true" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
