import { useEffect, useRef, useState } from "react";

import { AnimatePresence, motion, useInView } from "framer-motion";

import ProgressBar from "./ProgressBar/ProgressBar";
import TokenCarousel from "./TokenCarousel/TokenCarousel";
import styles from "./WhyBounce.module.css";
import { useIsMobile } from "../../../hooks/useIsMobile";
import DotsNavigation from "../../Global/DotsNavigation/DotsNavigation";

const COUNTDOWN_SECONDS = 6;

const WhyBounce = () => {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true });
  const [activeIndex, setActiveIndex] = useState(0);
  const [timerKey, setTimerKey] = useState(0);
  const isMobile = useIsMobile(1024);
  const timeoutRef = useRef<number | null>(null);

  const handleSelect = (index: number) => {
    setActiveIndex(index);
    setTimerKey((k) => k + 1);
    scheduleNext();
  };

  const scheduleNext = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = window.setTimeout(() => {
      setActiveIndex((i) => (i + 1) % 3);
      setTimerKey((k) => k + 1);
    }, COUNTDOWN_SECONDS * 1000);
  };

  useEffect(() => {
    if (!isInView) return;

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = window.setTimeout(() => {
      setActiveIndex((i) => (i + 1) % 3);
      setTimerKey((k) => k + 1);
    }, COUNTDOWN_SECONDS * 1000);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [activeIndex, isInView]);

  const SWIPE_THRESHOLD = 60;

  const handleSwipe = (offsetX: number) => {
    if (!isMobile) return;
    if (offsetX < -SWIPE_THRESHOLD) {
      handleSelect((activeIndex + 1) % 3);
    }
    if (offsetX > SWIPE_THRESHOLD) {
      handleSelect((activeIndex - 1 + 3) % 3);
    }
  };

  const descriptions = [
    "Stay in the game while others are forced out. Trade diverse markets without taking on liquidation risk.",
    "Capture every market move without having to rebalance. Get the exposure you want and keep it.",
    "Utilize your positions across all of DeFi and set your own terms with ERC-20 compliance.",
  ];

  return (
    <div className={styles.outerContainer}>
      <h2 className={styles.mobileTitle}>Why bounce?</h2>

      <div className={styles.contentContainer}>
        <h2 className={styles.title}>Why bounce?</h2>
        <div className={styles.mobileCarousel}>
          <TokenCarousel
            activeIndex={activeIndex}
            handleSelect={handleSelect}
          />
        </div>
        <div className={styles.content} ref={ref}>
          <div className={styles.subtitleContainer}>
            {isMobile ? (
              <>
                <AnimatePresence mode="wait">
                  <motion.div
                    key={activeIndex}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.6 }}
                    drag="x"
                    dragConstraints={{ left: 0, right: 0 }}
                    dragElastic={0}
                    dragMomentum={false}
                    onDragEnd={(_, info) => handleSwipe(info.offset.x)}
                    style={{
                      touchAction: "pan-y",
                      x: 0,
                    }}
                  >
                    {activeIndex === 0 && (
                      <>
                        <div className={styles.subtitle}>
                          <span>No</span> liquidations
                        </div>
                        <ProgressBar
                          duration={COUNTDOWN_SECONDS}
                          isActive={isInView}
                          key={timerKey}
                        />
                        <br style={{ height: "2rem" }} />
                        <div className={styles.mobileDescription}>
                          {descriptions[activeIndex]}
                        </div>
                      </>
                    )}
                    {activeIndex === 1 && (
                      <>
                        <div className={styles.subtitle}>
                          <span>Constant</span> leverage
                        </div>
                        <ProgressBar
                          duration={COUNTDOWN_SECONDS}
                          isActive={isInView}
                          key={timerKey}
                        />
                        <br style={{ height: "2rem" }} />
                        <div className={styles.mobileDescription}>
                          {descriptions[activeIndex]}
                        </div>
                      </>
                    )}
                    {activeIndex === 2 && (
                      <>
                        <div className={styles.subtitle}>
                          <span>Defi</span> composability
                        </div>
                        <ProgressBar
                          duration={COUNTDOWN_SECONDS}
                          isActive={isInView}
                          key={timerKey}
                        />
                        <br style={{ height: "2rem" }} />
                        <div className={styles.mobileDescription}>
                          {descriptions[activeIndex]}
                        </div>
                      </>
                    )}
                  </motion.div>
                </AnimatePresence>
              </>
            ) : (
              <>
                <div
                  className={`${
                    activeIndex === 0 ? styles.active : styles.inactive
                  } ${styles.clickable}`}
                  onClick={() => handleSelect(0)}
                >
                  <div className={styles.subtitle}>
                    <span>No</span> liquidations
                  </div>
                  <ProgressBar
                    duration={COUNTDOWN_SECONDS}
                    isActive={isInView && activeIndex === 0}
                    key={timerKey}
                  />
                </div>
                <div
                  className={`${
                    activeIndex === 1 ? styles.active : styles.inactive
                  } ${styles.clickable}`}
                  onClick={() => handleSelect(1)}
                >
                  <div className={styles.subtitle}>
                    <span>Constant</span> leverage
                  </div>
                  <ProgressBar
                    duration={COUNTDOWN_SECONDS}
                    isActive={isInView && activeIndex === 1}
                    key={timerKey}
                  />
                </div>
                <div
                  className={`${
                    activeIndex === 2 ? styles.active : styles.inactive
                  } ${styles.clickable}`}
                  onClick={() => handleSelect(2)}
                >
                  <div className={styles.subtitle}>
                    <span>Defi</span> composability
                  </div>
                  <ProgressBar
                    duration={COUNTDOWN_SECONDS}
                    isActive={isInView && activeIndex === 2}
                    key={timerKey}
                  />
                </div>
              </>
            )}
          </div>
          <AnimatePresence mode="wait">
            <motion.div
              key={activeIndex}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.6 }}
              className={styles.description}
            >
              {descriptions[activeIndex]}
            </motion.div>
          </AnimatePresence>
          <div className={styles.dotsNavigation}>
            <DotsNavigation
              count={3}
              activeIndex={activeIndex}
              onChange={handleSelect}
            />
          </div>
        </div>
      </div>
      <div className={styles.carousel}>
        <TokenCarousel activeIndex={activeIndex} handleSelect={handleSelect} />
      </div>
    </div>
  );
};

export default WhyBounce;
