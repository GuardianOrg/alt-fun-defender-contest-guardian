import { motion, type Variants } from "framer-motion";

import styles from "./Card2.module.css";
import background from "../../../../../assets/liquidation-journey/bg-illustration-2.webp";
import { useAssetLogos } from "../assetLogos";
import { Header } from "../Header/Header";
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

type FormattedPercent = {
  percentage: string;
  className: string;
};

const formatTopPercent = (value: number): FormattedPercent => {
  if (typeof value !== "number" || isNaN(value)) {
    return { percentage: "0.1%", className: "subZero" };
  }

  const percent = value * 100;

  if (percent < 0.01) {
    return { percentage: "0.01%", className: "subZeroPtOne" };
  }

  if (percent < 0.1) {
    return { percentage: "0.1%", className: "subZero" };
  }

  if (percent < 1) {
    return {
      percentage: `${Math.floor(percent * 10) / 10}%`,
      className: "subZero",
    };
  }

  if (percent >= 10) {
    return {
      percentage: `${Math.floor(percent)}%`,
      className: "twoDecimal",
    };
  }

  const cropped = Math.floor(percent * 10) / 10;
  return {
    percentage: `${cropped}%`,
    className: "oneDecimal",
  };
};

export const Card2 = ({
  liquidationJourneyData,
  isActive,
}: {
  liquidationJourneyData: LiquidationJourneyData;
  isActive: boolean;
}) => {
  const highestPercentAsset = liquidationJourneyData.assets.reduce(
    (minAsset, asset) =>
      asset.topPercent < minAsset.topPercent ? asset : minAsset,
  );

  const { percentage, className } = formatTopPercent(
    highestPercentAsset.topPercent,
  );

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
      <Header />
      <motion.div
        variants={itemVariants}
        className={`${styles.congrats} ${styles.topText}`}
      >
        Where you stood out:
      </motion.div>

      <motion.div variants={itemVariants} className={styles.titleWrapper}>
        <div className={styles.titleSquare}>
          <div className={styles.titleSquareTopRow}>
            <span className={styles.top}>Top</span>
            <div className={styles.tokenImageContainer}>
              {getHasLogo(highestPercentAsset.asset) ? (
                <img
                  className={styles.tokenImage}
                  src={getAssetLogoUrl(highestPercentAsset.asset)}
                  alt={highestPercentAsset.asset}
                />
              ) : (
                highestPercentAsset.asset
              )}
            </div>
          </div>

          <span className={`${styles[className]}`}>{percentage}</span>
        </div>
      </motion.div>

      <motion.div variants={itemVariants} className={styles.congrats}>
        {highestPercentAsset.asset} liquidation farmer
      </motion.div>
    </motion.div>
  );
};
