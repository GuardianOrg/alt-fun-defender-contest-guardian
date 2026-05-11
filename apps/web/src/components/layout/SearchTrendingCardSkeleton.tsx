import styles from "./SearchModal.module.css";
import Skeleton from "../shared/Skeleton";

/**
 * Layout-matched placeholder for `<SearchTrendingCard>`. Sized identically
 * so the trending row keeps a stable width when the first token list lands.
 */
export default function SearchTrendingCardSkeleton() {
  return (
    <div className={styles.trendingCard} aria-hidden="true">
      <div className={styles.trendingCardHeader}>
        <Skeleton
          shape="block"
          width="26px"
          height="26px"
          radius="3px"
          className={styles.trendingCardIcon}
        />
        <div className={styles.trendingCardText}>
          <Skeleton width="80%" height="12px" />
          <Skeleton
            width="60%"
            height="10px"
            className={styles.trendingCardSubline}
          />
        </div>
      </div>
      <div className={styles.trendingCardStats}>
        <Skeleton width="3rem" height="12px" />
        <Skeleton width="2rem" height="12px" />
      </div>
    </div>
  );
}
