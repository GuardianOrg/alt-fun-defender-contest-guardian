import styles from "./BottomTabs.module.css";
import { cn } from "../../utils/format";
import Skeleton from "../shared/Skeleton";

import type { Holder } from "../../services/types";

// Number of placeholder rows to render while `useHolders` is loading the
// first page. Matches the typical visible-row count post-load so the panel
// reads as populated and the table height stays stable.
const HOLDER_SKELETON_COUNT = 8;

interface Props {
  holders: Holder[];
  /** True while `useHolders` is fetching for the first time. */
  isLoading?: boolean;
}

export default function HoldersTab({ holders, isLoading = false }: Props) {
  const maxSupply = Math.max(...holders.map((h) => h.percentSupply), 1);
  const showSkeletons = isLoading && holders.length === 0;

  return (
    <div
      className={styles.holdersWrap}
      aria-busy={showSkeletons ? true : undefined}
    >
      <div className={styles.holdersHeader}>
        <div>#</div>
        <div>wallet</div>
        <div>tokens</div>
        <div>% supply</div>
        <div>bar</div>
      </div>
      {showSkeletons
        ? Array.from({ length: HOLDER_SKELETON_COUNT }, (_, i) => (
            <div key={i} className={styles.holderRow} aria-hidden="true">
              <div className={styles.holderRank}>
                <Skeleton width="1.25rem" height="11px" />
              </div>
              <div className={styles.holderAddress}>
                <Skeleton width="11rem" height="12px" />
              </div>
              <div className={styles.holderTokens}>
                <Skeleton width="4rem" height="12px" />
              </div>
              <div className={styles.holderPercent}>
                <Skeleton width="2.5rem" height="12px" />
              </div>
              <div>
                <div className={styles.barTrack}>
                  <Skeleton
                    shape="block"
                    width="60%"
                    height="3px"
                    radius="9999px"
                  />
                </div>
              </div>
            </div>
          ))
        : holders.map((h) => (
            <div key={h.rank} className={styles.holderRow}>
              <div className={styles.holderRank}>{h.rank}</div>
              <div className={styles.holderAddress}>
                {h.address}
                {h.isCreator && (
                  <span className={styles.holderCreator}>creator</span>
                )}
              </div>
              <div className={styles.holderTokens}>{h.tokens}</div>
              <div className={styles.holderPercent}>{h.percentSupply}%</div>
              <div>
                <div className={styles.barTrack}>
                  <div
                    className={cn(styles.barFill, "bar-glow-mint")}
                    style={{ width: `${(h.percentSupply / maxSupply) * 100}%` }}
                  />
                </div>
              </div>
            </div>
          ))}
    </div>
  );
}
