import styles from "./TokenInfoStrip.module.css";
import Skeleton from "../shared/Skeleton";

/**
 * Layout-matched placeholder for `<TokenInfoStrip>`. Mirrors the live strip's
 * three-stat group + socials slot so the row below the chart doesn't pop in
 * once `useToken` resolves.
 */
export default function TokenInfoStripSkeleton() {
  return (
    <div className={styles.strip} aria-hidden="true">
      <div className={styles.statsGroup}>
        <div className={styles.stat}>
          <span className={styles.label}>Vol 24hr</span>
          <Skeleton width="4rem" height="13px" />
        </div>

        <div className={styles.stat}>
          <span className={styles.label}>Leverage Boost</span>
          <Skeleton width="3rem" height="13px" />
        </div>
      </div>

      <div className={`${styles.stat} ${styles.statEnd}`}>
        <span className={styles.label}>Socials</span>
        <Skeleton width="3.5rem" height="13px" />
      </div>
    </div>
  );
}
