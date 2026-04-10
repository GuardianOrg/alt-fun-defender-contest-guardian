import { motion, type Variants } from "framer-motion";

import styles from "./Card1.module.css";
import HyperliquidBlob from "../../../../../assets/Hyperliquid/GradientVariants/HyperliquidBlob";
import background from "../../../../../assets/liquidation-journey/bg-illustration-1.webp";
import { Logo } from "../../../../../assets/Logo";
import { formatNumber } from "../../../../../utils/formatNumber.util";
import { useAssetLogos } from "../assetLogos";
import cardStyles from "../LiquidationJourneyCard.module.css";

import type { LiquidationJourneyData } from "../../../../../hooks/useLiquidationJourneyData";

const containerVariants = {
  hidden: {
    transition: { duration: 0, staggerChildren: 0 },
  },
  visible: {
    transition: {
      staggerChildren: 0.5,
    },
  },
};

const itemVariants: Variants = {
  hidden: {
    opacity: 0,
    y: 20,
    transition: { duration: 0 },
  },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 1,
      ease: [0.16, 1, 0.3, 1],
    },
  },
};

export const Card1 = ({
  liquidationJourneyData,
  isActive,
}: {
  liquidationJourneyData: LiquidationJourneyData;
  isActive: boolean;
}) => {
  const { getHasLogo, getAssetLogoUrl } = useAssetLogos();

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate={isActive ? "visible" : "hidden"}
      className={`${cardStyles.container} ${styles.card}`}
    >
      <img
        src={background}
        alt="Background"
        className={cardStyles.backgroundImage}
      />

      <div className={styles.logoContainer}>
        <Logo color="var(--hl-foam)" size={"30cqw"} />
      </div>

      <motion.div variants={itemVariants} className={styles.titleContainer}>
        <div className={styles.hyperliquidContainer}>
          <HyperliquidBlob />
        </div>
        <span className={styles.liquidations}>Liquidations</span>
        <span className={styles.wrapped}>Wrapped</span>
      </motion.div>

      <motion.div variants={itemVariants} className={styles.firstTradeIntro}>
        Where it all began...
      </motion.div>

      <motion.div variants={itemVariants} className={styles.firstTrade}>
        <div className={styles.tokenImageContainer}>
          {getHasLogo(liquidationJourneyData.firstLiquidation.asset) ? (
            <img
              className={styles.tokenImage}
              src={getAssetLogoUrl(
                liquidationJourneyData.firstLiquidation.asset,
              )}
              alt={liquidationJourneyData.firstLiquidation.asset}
            />
          ) : (
            liquidationJourneyData.firstLiquidation.asset
          )}
        </div>

        <div className={styles.firstTradeDetails}>
          <span className={styles.timestamp}>
            {new Date(
              liquidationJourneyData.firstLiquidation.timestamp,
            ).toLocaleDateString("en-US", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
            :
          </span>

          <span className={styles.assetName}>
            {liquidationJourneyData.firstLiquidation.asset}{" "}
            <span className={styles.positionDirection}>
              {!liquidationJourneyData.firstLiquidation.isLong
                ? "(Long)"
                : "(Short)"}
            </span>
          </span>

          <span className={`negative ${styles.notional}`}>
            {liquidationJourneyData.firstLiquidation.notional < 0.005
              ? "<$0.01"
              : `${formatNumber(
                  liquidationJourneyData.firstLiquidation.notional,
                  false,
                  true,
                )}`}
          </span>
        </div>
      </motion.div>
    </motion.div>
  );
};
