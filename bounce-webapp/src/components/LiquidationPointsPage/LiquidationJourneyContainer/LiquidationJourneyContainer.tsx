import styles from "./LiquidationJourneyContainer.module.css";
import { HyperliquidFullLogo } from "../../../assets/Hyperliquid/HyperliquidFullLogo";
import radialMask from "../../../assets/liquidation-journey/background.webp";
import Button from "../../Global/Buttons/Button";

const LiquidationJourneyContainer = ({
  openLiquidationsWrapped,
}: {
  openLiquidationsWrapped: () => void;
}) => {
  return (
    <div className={styles.mainCard}>
      <img
        src={radialMask}
        alt="Background mask"
        className={styles.statsCardBg}
      />
      <div className={styles.header}>
        <HyperliquidFullLogo color="white" size={240} />
        <span className={styles.title}>Liquidations Wrapped</span>
      </div>
      <Button variant="hyperliquid" onClick={openLiquidationsWrapped}>
        View your liquidations wrapped
      </Button>
    </div>
  );
};

export default LiquidationJourneyContainer;
