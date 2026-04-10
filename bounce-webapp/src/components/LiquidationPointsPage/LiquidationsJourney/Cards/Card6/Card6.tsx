import { useEffect } from "react";

import {
  motion,
  useMotionValue,
  useTransform,
  animate,
  type MotionValue,
} from "framer-motion";

import styles from "./Card6.module.css";
import background from "../../../../../assets/liquidation-journey/bg-illustration-6.webp";
import dial from "../../../../../assets/liquidation-journey/dial.png";
import { useIsMobile } from "../../../../../hooks/useIsMobile";
import { formatNumber } from "../../../../../utils/formatNumber.util";
import useClaimPoints from "../../../../../web3/writes/useClaimPoints";
import cardStyles from "../LiquidationJourneyCard.module.css";
import { DialPointer } from "./DialPointer";
import { scoreToDegrees } from "./scoreToRotation.util";
import Button from "../../../../Global/Buttons/Button";
import { Header } from "../Header/Header";

import type { LiquidationJourneyData } from "../../../../../hooks/useLiquidationJourneyData";

const DIAL_DURATION_SCALE = 150; // same as CountUp: duration = score / 100

interface Card6Props {
  liquidationJourneyData: LiquidationJourneyData;
  isActive: boolean;
  isPrivacyMode?: boolean;
  hasClaimedScore?: boolean;
  close: () => void;
}

export const Card6 = ({
  liquidationJourneyData,
  isActive,
  isPrivacyMode = false,
  hasClaimedScore = false,
  close,
}: Card6Props) => {
  const isMobile = useIsMobile(768);
  const { claimPoints, isPending } = useClaimPoints();
  const containerVariants = {
    hidden: { transition: { duration: 0, staggerChildren: 0 } },
    visible: { transition: { staggerChildren: 0.5 } },
  };

  const hidden = { opacity: 0, y: 20, transition: { duration: 0 } };
  const visible = { opacity: 1, y: 0 };
  const t = { duration: 0.8, ease: [0.16, 1, 0.3, 1] as const };

  const liquidationScore = liquidationJourneyData.score;
  const rotationDegrees = scoreToDegrees(liquidationScore);

  // Motion values for progress, count, and dial rotation
  const progress = useMotionValue(0);
  const displayCount = useTransform(progress, [0, 1], [300, liquidationScore]);
  const dialRotation = useTransform(
    progress,
    [0, 1],
    [-90, rotationDegrees - 90],
  );

  const delay = 1.2;
  const duration = liquidationScore / DIAL_DURATION_SCALE;

  // Animate progress when active
  useEffect(() => {
    if (!isActive) {
      progress.set(0);
      return;
    }
    const controls = animate(progress, 1, { duration, delay, ease: "easeOut" });
    return () => controls.stop();
  }, [isActive, progress, duration]);

  // Rounded display for count without React state
  const roundedCount = useTransform(displayCount, (v) => Math.round(v));

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

      <div
        className={`${styles.textContainer} ${isPrivacyMode ? styles.textContainerPrivacy : ""} ${hasClaimedScore ? styles.claimed : ""}`}
      >
        <motion.div
          initial={hidden}
          animate={isActive ? visible : hidden}
          transition={{ ...t, delay: 0 }}
          className={styles.titleContainer}
        >
          In summary...
        </motion.div>

        {!isPrivacyMode && (
          <>
            <motion.div
              initial={hidden}
              animate={isActive ? visible : hidden}
              transition={{ ...t, delay: 0.3 }}
              className={styles.totalNotional}
            >
              {formatNumber(
                liquidationJourneyData.totalLiquidationNotional,
                false,
                true,
              )}
            </motion.div>

            <motion.div
              initial={hidden}
              animate={isActive ? visible : hidden}
              transition={{ ...t, delay: 0.6 }}
              className={styles.insetText}
            >
              {liquidationJourneyData.totalLiquidationCount} Liquidation Events
            </motion.div>
          </>
        )}

        <motion.div
          initial={hidden}
          animate={isActive ? visible : hidden}
          transition={{ ...t, delay: 0.9 }}
          className={`${styles.liquidationScoreTitle} ${isPrivacyMode ? styles.liquidationScorePrivacy : ""}`}
        >
          Your liquidation score:
        </motion.div>

        <motion.div
          initial={hidden}
          animate={isActive ? visible : hidden}
          transition={{ ...t, delay: 1.2 }}
          className={styles.dialWrapper}
        >
          <img
            src={dial}
            alt="Dial"
            className={styles.dialImage}
            decoding="sync"
            loading="eager"
          />
          <div className={styles.arrowOverlay}>
            <DialPointer rotation={dialRotation as MotionValue<number>} />
          </div>
        </motion.div>

        <motion.div
          initial={hidden}
          animate={isActive ? visible : hidden}
          transition={{ ...t, delay: 1.2 }}
          className={styles.liquidationScore}
        >
          <motion.span className={styles.countUp} style={{}}>
            {roundedCount}
          </motion.span>
        </motion.div>

        <motion.div
          initial={hidden}
          animate={isActive ? visible : hidden}
          transition={{ ...t, delay: 1.2 }}
        >
          {!hasClaimedScore && (
            <Button
              variant="hyperliquid"
              rounded
              onClick={() => {
                claimPoints();
                setTimeout(close, 1000);
              }}
              loading={isPending}
              disabled={isPending}
              size={isMobile ? "small" : "medium"}
            >
              Claim score
            </Button>
          )}
        </motion.div>
      </div>
    </motion.div>
  );
};
