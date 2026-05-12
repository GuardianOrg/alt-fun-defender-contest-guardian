import styles from "./TradePanel.module.css";
import Skeleton from "../shared/Skeleton";

/**
 * Layout-matched placeholder for `<TradePanel>`. Renders while `useToken`
 * is in flight so the right-hand column doesn't pop in once the metadata
 * lands. Width and stacking mirror the live panel exactly so the chart
 * area to the left keeps a stable flex track.
 */
export default function TradePanelSkeleton() {
  return (
    <div className={styles.panel} aria-busy="true" aria-label="Loading trade panel">
      <div className={styles.toggleBar} aria-hidden="true">
        <div className={styles.toggleGrid}>
          <div className={styles.modeSkeleton}>
            <Skeleton width="2rem" height="13px" />
          </div>
          <div className={styles.modeSkeleton}>
            <Skeleton width="2rem" height="13px" />
          </div>
        </div>
        <div className={styles.gearWrap}>
          <Skeleton shape="block" width="14px" height="14px" />
        </div>
      </div>

      <div className={styles.formBody} aria-hidden="true">
        <Skeleton shape="block" width="100%" height="4rem" radius="3px" />
        <Skeleton shape="block" width="100%" height="1.2rem" />
        <Skeleton shape="block" width="100%" height="2.5rem" radius="2px" />
        <Skeleton shape="block" width="100%" height="1rem" />
      </div>
    </div>
  );
}
