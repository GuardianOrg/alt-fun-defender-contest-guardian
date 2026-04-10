import { motion, type Variants } from "framer-motion";

import styles from "./Card3.module.css";
import background from "../../../../../assets/liquidation-journey/bg-illustration-3.webp";
import cardStyles from "../LiquidationJourneyCard.module.css";
import { LiquidationCircleCloud } from "./LiquidationCircleCloud";
import { useIsMobile } from "../../../../../hooks/useIsMobile";
import { formatNumber } from "../../../../../utils/formatNumber.util";
import { Header } from "../Header/Header";

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

export const Card3 = ({
  liquidationJourneyData,
  isActive,
}: {
  liquidationJourneyData: LiquidationJourneyData;
  isActive: boolean;
}) => {
  const isMobile = useIsMobile(768);
  const assets = liquidationJourneyData.assets;

  // Sort assets descending by totalLiquidationNotional
  const sortedAssets = [...assets].sort(
    (a, b) => b.totalLiquidationNotional - a.totalLiquidationNotional,
  );

  const showAllSix = sortedAssets.length === 6;

  // Assets to render as individual rows
  const displayedAssets = showAllSix ? sortedAssets : sortedAssets.slice(0, 5);

  // Remaining assets (only used when NOT exactly 6)
  const remainingAssets = showAllSix ? [] : sortedAssets.slice(5);
  const remainingCount = remainingAssets.length;

  const remainingTotal = remainingAssets.reduce(
    (sum, asset) => sum + asset.totalLiquidationNotional,
    0,
  );

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
      <Header />

      <motion.div variants={itemVariants} className={styles.titleContainer}>
        Your Liquidated Assets
      </motion.div>

      <LiquidationCircleCloud
        width={isMobile ? 160 : 290}
        height={isMobile ? 160 : 290}
        assets={assets}
        isActive={isActive}
      />

      <motion.div variants={itemVariants} className={styles.summaryTable}>
        {displayedAssets.map((asset) => (
          <div key={asset.asset} className={styles.summaryRow}>
            <span className={styles.assetName}>{asset.asset}</span>
            <span className={styles.assetValue}>
              {asset.totalLiquidationNotional < 0.5
                ? "<$1"
                : `${formatNumber(asset.totalLiquidationNotional, false, true, false, true)}`}
            </span>
          </div>
        ))}
        {!showAllSix && remainingCount > 0 && (
          <div className={styles.summaryRow}>
            <span className={styles.assetName}>+{remainingCount} more</span>
            <span className={styles.assetValue}>
              {formatNumber(remainingTotal, false, true, false, true)}
            </span>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
};
