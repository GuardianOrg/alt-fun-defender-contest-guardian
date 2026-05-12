import styles from "./HeroSection.module.css";
import Skeleton from "../shared/Skeleton";

/**
 * Layout-matched placeholder for `<HeroSection>`. Renders while `useToken`
 * is in flight so the column has stable height and the chart fiber below
 * never reflows when the token metadata lands.
 */
export default function HeroSectionSkeleton() {
  return (
    <div className={styles.wrapper} aria-hidden="true">
      <div className={styles.rightGroup}>
        <Skeleton shape="block" width="6rem" height="6rem" radius="3px" />
        <div className={styles.nameStack}>
          <div className={styles.tickerNameContainer}>
            <Skeleton width="6rem" height="1.25rem" />
            <Skeleton width="9rem" height="0.9rem" />
          </div>
          <div className={styles.byDev}>
            <Skeleton width="8rem" height="11px" />
          </div>
        </div>
      </div>

      <div className={styles.leftGroup}>
        <Skeleton width="8rem" height="1.4rem" radius="3px" />
        <Skeleton width="5rem" height="1.6rem" radius="3px" />
      </div>
    </div>
  );
}
