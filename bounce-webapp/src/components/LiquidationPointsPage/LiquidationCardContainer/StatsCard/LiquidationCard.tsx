import styles from "./LiquidationCard.module.css";
import radialMask from "../../../../assets/radial-mask.webp";
import whiteLogo from "../../../../assets/white-logo.svg";
import { formatNumber } from "../../../../utils/formatNumber.util";

import type { LiquidationJourneyData } from "../../../../hooks/useLiquidationJourneyData";
import type { OverlayKey, OverlayOption } from "../liquidationOverlays";

interface LiquidationCardProps {
  userData: LiquidationJourneyData;
  activeOverlay: OverlayKey | "none";
  overlays: OverlayOption[];
}

const LiquidationCard = ({
  userData,
  activeOverlay,
  overlays,
}: LiquidationCardProps) => {
  const activeImage =
    activeOverlay === "none"
      ? null
      : overlays.find((o) => o.key === activeOverlay);

  return (
    <div className={styles.statsCard}>
      <img
        src={radialMask}
        alt="Background mask"
        className={styles.statsCardBg}
      />

      <div className={styles.stats}>
        <img src={whiteLogo} alt="Bounce logo" className={styles.logo} />

        <div className={styles.statsTextContainer}>
          <p className={styles.yourTotalLiquidated}>Your total liquidated</p>
          <div className={styles.liquidatedAmount}>
            <span>$</span>
            <p>{formatNumber(userData.totalLiquidationNotional)}</p>
          </div>

          <p className={styles.liquidationPoints}>Liquidation score</p>
          <p className={styles.liquidationPointsAmount}>{userData.score}</p>

          <p className={styles.referralCode}>Find us at</p>
          <p className={styles.referralCodeValue}>
            bounce.tech/liquidation-score
          </p>
        </div>
      </div>

      {activeImage && (
        <div className={styles.maskedOverlayContainer}>
          <img src={activeImage.image} alt={`${activeImage.key} overlay`} />
        </div>
      )}
    </div>
  );
};

export default LiquidationCard;
