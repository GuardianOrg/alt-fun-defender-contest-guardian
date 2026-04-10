import styles from "./PreLoginCard.module.css";
import background from "../../../../assets/liquidation-journey/pre-login-background.png";
import Connector from "../../../Global/Connector/Connector";

const PreLoginCard = () => {
  return (
    <div className={styles.preLoginWrapper}>
      <div className={styles.mainCard}>
        <img src={background} alt="" className={styles.cardBg} aria-hidden />
        <div className={styles.cardContent}>
          <h2 className={styles.mainCardTitle}>
            Claim a score for your past liquidations
          </h2>
          <p className={styles.mainCardText}>
            Users who got liquidated on any Hyperliquid perps market are now
            eligible to claim.
          </p>
          <div className={styles.connectorSlot}>
            <Connector variant="hyperliquid-white" />
          </div>
        </div>
      </div>
    </div>
  );
};

export default PreLoginCard;
