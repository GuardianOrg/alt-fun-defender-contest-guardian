import styles from "./BottomTabs.module.css";
import { cn } from "../../utils/format";

import type { Holder } from "../../services/types";

export default function HoldersTab({ holders }: { holders: Holder[] }) {
  const maxSupply = Math.max(...holders.map((h) => h.percentSupply), 1);

  return (
    <div className={styles.holdersWrap}>
      <div className={styles.holdersHeader}>
        <div>#</div>
        <div>wallet</div>
        <div>tokens</div>
        <div>% supply</div>
        <div>bar</div>
      </div>
      {holders.map((h) => (
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
