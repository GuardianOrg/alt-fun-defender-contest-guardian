import styles from "./LoginCards.module.css";

const PostLoginCard = () => {
  return (
    <div className={styles.mainCard}>
      <h2 className={styles.mainCardTitle}>
        Looks like you haven't been liquidated on Hyperliquid.
      </h2>
      <p className={styles.mainCardText}>
        No Liquidation Points for you, but hey, avoiding wreckage is a win too.
        🫡
      </p>
    </div>
  );
};

export default PostLoginCard;
