import styles from "./Cards.module.css";
import InfoTooltip from "../../../Global/Tooltip/InfoTooltip";

interface StatProps {
  title: string;
  tooltip: string;
  value?: string;
  snapshot?: string;
}

const Stat = ({ title, value, tooltip, snapshot }: StatProps) => {
  return (
    <div className={`${styles.card} ${styles.statCard}`}>
      <>
        <div className={styles.cardTitleContainer}>
          <h3 className={`${styles.cardTitle} ${styles.statCardTitle}`}>
            {title}
          </h3>
          <InfoTooltip content={tooltip} />
        </div>
        {value ? (
          <p className={`${styles.value} ${styles.statValue}`}>{value}</p>
        ) : (
          <div className={styles.noValue}>--</div>
        )}
      </>
      {snapshot && <p className={styles.snapshot}>{snapshot}</p>}
    </div>
  );
};

export default Stat;
