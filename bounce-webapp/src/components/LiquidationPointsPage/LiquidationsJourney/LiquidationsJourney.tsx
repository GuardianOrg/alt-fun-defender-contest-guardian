import "swiper/css/bundle";
import "swiper/css/navigation";
import "swiper/css/pagination";
import "swiper/css/effect-fade";

import { useEffect, useRef, useState } from "react";

import { AnimatePresence, motion, type Variants } from "framer-motion";
import { Navigation, Pagination, EffectFade } from "swiper/modules";
import { Swiper, SwiperSlide } from "swiper/react";

import { Card1 } from "./Cards/Card1/Card1";
import { Card2 } from "./Cards/Card2/Card2";
import { Card3 } from "./Cards/Card3/Card3";
import { Card4 } from "./Cards/Card4/Card4";
import { Card5 } from "./Cards/Card5/Card5";
import { Card6 } from "./Cards/Card6/Card6";
import styles from "./LiquidationsJourney.module.css";
import ShareCardControls from "../../MintPage/Modals/SharedComponents/ShareCardControls/ShareCardControls";

import type { LiquidationJourneyData } from "../../../hooks/useLiquidationJourneyData";

interface LiquidationJourneyProps {
  liquidationJourneyData: LiquidationJourneyData;
  show: boolean;
  hasClaimedScore: boolean;
  close: () => void;
}

export const LiquidationsJourney = ({
  liquidationJourneyData,
  show,
  hasClaimedScore,
  close,
}: LiquidationJourneyProps) => {
  const [isPrivacyMode, setIsPrivacyMode] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0); // for logic
  const [delayedActiveIndex, setDelayedActiveIndex] = useState(-1); // for animations (-1 = wait for open)
  const statsRef = useRef<HTMLDivElement>(null);
  const activeIndexRef = useRef(0);

  activeIndexRef.current = activeIndex;

  // On open: reset to slide 0 and, after modal fade-in, mark current slide active
  useEffect(() => {
    if (!show) {
      setDelayedActiveIndex(-1);
      return;
    }
    setActiveIndex(0); // Swiper remounts at 0; keep state in sync so timeout sets correct delayedActiveIndex
    const t = setTimeout(
      () => setDelayedActiveIndex(activeIndexRef.current),
      250,
    );
    return () => clearTimeout(t);
  }, [show]);

  const fadeVariants: Variants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { duration: 0.25, ease: "easeInOut" } },
    exit: { opacity: 0, transition: { duration: 0.25, ease: "easeInOut" } },
  };

  const cards = [Card1, Card2, Card3, Card4, Card5, Card6];

  // Prevent background scrolling when modal is open
  useEffect(() => {
    if (show) {
      document.documentElement.style.overflow = "hidden";
    } else {
      document.documentElement.style.overflow = "";
    }
    return () => {
      document.documentElement.style.overflow = "";
    };
  }, [show]);

  return (
    <AnimatePresence mode="wait">
      {show && (
        <motion.div
          className={styles.container}
          variants={fadeVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
        >
          <motion.button
            className={styles.closeBackground}
            onClick={close}
            initial={{ opacity: 0, backdropFilter: "blur(0px)" }}
            animate={{ opacity: 1, backdropFilter: "blur(10px)" }}
            exit={{ opacity: 0, backdropFilter: "blur(0px)" }}
            transition={{ duration: 0.25 }}
            type="button"
            aria-label="Close liquidations wrapped"
          />

          <Swiper
            navigation
            pagination={{ dynamicBullets: true, clickable: true }}
            effect="fade"
            modules={[Navigation, Pagination, EffectFade]}
            className={styles.swiper}
            speed={600}
            onSlideChange={(swiper) => setActiveIndex(swiper.activeIndex)}
            onSlideChangeTransitionEnd={(swiper) => {
              setDelayedActiveIndex(swiper.activeIndex);
            }}
          >
            {cards.map((Card, index) => (
              <SwiperSlide className={styles.slide} key={index}>
                <div
                  ref={index === activeIndex ? statsRef : null}
                  className={styles.cardContainer}
                >
                  <Card
                    liquidationJourneyData={liquidationJourneyData}
                    isActive={index === delayedActiveIndex}
                    isPrivacyMode={isPrivacyMode}
                    hasClaimedScore={hasClaimedScore}
                    close={close}
                  />
                </div>
              </SwiperSlide>
            ))}

            <div className={styles.controlsContainer}>
              <ShareCardControls
                statsRef={statsRef}
                toggleProps={{
                  showing: activeIndex === 5,
                  label: `Hide details`,
                  ariaLabel: "Privacy mode toggle",
                  checked: isPrivacyMode,
                  onToggle: () => setIsPrivacyMode(!isPrivacyMode),
                }}
              />
            </div>
          </Swiper>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
