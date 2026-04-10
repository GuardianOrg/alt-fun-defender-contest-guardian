import { motion } from "framer-motion";

import styles from "./Card5.module.css";
import background from "../../../../../assets/liquidation-journey/bg-illustration-5.webp";
import { Header } from "../Header/Header";
import cardStyles from "../LiquidationJourneyCard.module.css";

import type { LiquidationJourneyData } from "../../../../../hooks/useLiquidationJourneyData";

export const Card5 = ({
  liquidationJourneyData,
  isActive,
}: {
  liquidationJourneyData: LiquidationJourneyData;
  isActive: boolean;
}) => {
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

  const hidden = {
    opacity: 0,
    y: 20,
    transition: { duration: 0 },
  };
  const visible = { opacity: 1, y: 0 };
  const t = { duration: 0.8, ease: [0.16, 1, 0.3, 1] as const };

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate={isActive ? "visible" : "hidden"}
      className={`${cardStyles.container} ${styles.card}`}
    >
      <Header />
      <img
        src={background}
        alt="Background"
        className={cardStyles.backgroundImage}
      />
      <motion.div
        initial={hidden}
        animate={isActive ? visible : hidden}
        transition={{ ...t, delay: 0 }}
        className={styles.title}
      >
        {liquidationJourneyData.liquidatedOnTenthOfOctober2025
          ? "A moment of silence..."
          : "Congrats!"}
      </motion.div>
      <motion.div
        initial={hidden}
        animate={isActive ? visible : hidden}
        transition={{ ...t, delay: 0.3 }}
        className={styles.subtitle}
      >
        10/10/25, never forget...
      </motion.div>
      <motion.div
        initial={hidden}
        animate={isActive ? visible : hidden}
        transition={{ ...t, delay: 0.6 }}
        className={styles.ten}
      >
        10
      </motion.div>
      <motion.div
        initial={hidden}
        animate={isActive ? visible : hidden}
        transition={{ ...t, delay: 1.2, duration: 1.5 }}
        className={`${styles.status} ${
          liquidationJourneyData.liquidatedOnTenthOfOctober2025
            ? styles.victim
            : styles.survivor
        }`}
      >
        {liquidationJourneyData.liquidatedOnTenthOfOctober2025
          ? "VICTIM"
          : "SURVIVOR"}
      </motion.div>
      <motion.div
        initial={hidden}
        animate={isActive ? visible : hidden}
        transition={{ ...t, delay: 0.6 }}
        className={styles.ten}
      >
        10
      </motion.div>
    </motion.div>
  );
};
