import styles from "./HeroStats.module.css";
import useBounceStats from "../../../hooks/Indexer/useBounceStats";
import StatCard from "../StatCard/StatCard";

const HeroStats = () => {
  const stats = useBounceStats();

  return (
    <div className={styles.heroStats}>
      <div className={styles.statsSection}>
        <StatCard
          value={`$${stats.notionalVolume.toFixed(2)}`}
          label="Total volume"
        />
        {/* Add later */}
        {/* <StatCard value="200+" label="Open Interest" /> */}
        <StatCard value="$0" label="Liquidations" />
      </div>
    </div>
  );
};

export default HeroStats;
