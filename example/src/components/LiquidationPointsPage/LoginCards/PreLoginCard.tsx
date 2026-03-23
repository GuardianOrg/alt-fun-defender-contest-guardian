import styles from "./LoginCards.module.css";
import Connector from "../../Global/Connector/Connector";

const PreLoginCard = () => {
  return (
    <div className={`${styles.mainCard}`}>
      <h2 className={styles.mainCardTitle}>
        Claim points for your past liquidations
      </h2>
      <p className={styles.mainCardText}>
        Liquidation points are now available for Hyperliquid perps traders.
        Users who got liquidated on any Hyperliquid perps market are eligible to
        claim.
      </p>
      <div className={styles.connectorContainer}>
        <Connector white />
      </div>
    </div>
  );
};

export default PreLoginCard;
