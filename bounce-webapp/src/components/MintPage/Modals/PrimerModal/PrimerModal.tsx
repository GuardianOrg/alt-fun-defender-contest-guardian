import { useEffect, useLayoutEffect, useState } from "react";

import { AnimatePresence, motion } from "framer-motion";
import Lottie from "lottie-react";
import { useDispatch, useSelector } from "react-redux";

import styles from "./PrimerModal.module.css";
import { Chevron } from "../../../../assets/Chevron";
import howTheyWork from "../../../../assets/PrimerAssets/how-they-work.json";
import noLiquidations from "../../../../assets/PrimerAssets/no-liquidations.json";
import readyToBounce from "../../../../assets/PrimerAssets/ready-to-bounce.json";
import upDownLevering from "../../../../assets/PrimerAssets/up-down-levering.json";
import volatilityDecay from "../../../../assets/PrimerAssets/volatility-decay.json";
import whatAreLeveragedTokens from "../../../../assets/PrimerAssets/what-are-leveraged-tokens.json";
import { useAllowPageAccess } from "../../../../hooks/useAllowPageAccess";
import {
  closePrimerModal,
  selectPrimerModalIsOpen,
  selectPrimerModalReplayNonce,
  setPrimerModalOpen,
} from "../../../../state/mintSlice";
import {
  hasViewedMintPrimer,
  markMintPrimerViewed,
} from "../../../../utils/mintPrimerStorage";
import Button from "../../../Global/Buttons/Button";
import Popup from "../../../Global/Popup/Popup";

import type { AppDispatch } from "../../../../state/store";

const primerTextFade = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
};

const primerTextFadeTransition = {
  duration: 0.22,
  ease: [0.4, 0, 0.2, 1] as const,
};

const PrimerModal = () => {
  const dispatch = useDispatch<AppDispatch>();
  const allowPageAccess = useAllowPageAccess();
  const isOpen = useSelector(selectPrimerModalIsOpen);
  const replayNonce = useSelector(selectPrimerModalReplayNonce);
  const [activeStage, setActiveStage] = useState(0);

  useEffect(() => {
    setActiveStage(0);
  }, [replayNonce]);

  // Keep Redux in sync with localStorage: persist rehydration can leave isOpen false
  // while bounce_mint_primer_viewed is unset — reopen when the user still hasn't viewed.
  useLayoutEffect(() => {
    if (!hasViewedMintPrimer()) {
      dispatch(setPrimerModalOpen(true));
    }
  }, [dispatch]);

  const primerStages = [
    {
      id: 1,
      header: "What are Leveraged Tokens?",
      bodyText: (
        <>
          Leveraged tokens allow traders to gain leveraged exposure to assets
          without the risk of liquidation.
        </>
      ),
      src: whatAreLeveragedTokens,
    },
    {
      id: 2,
      header: "How they work",
      bodyText: (
        <>
          Each leveraged token is backed by a Hyperliquid perps position.
          <br />
          <br />
          When prices move, Bounce automatically rebalances exposure to keep
          leverage near target. Profits boost position size, losses reduce it.
        </>
      ),
      src: howTheyWork,
    },
    {
      id: 3,
      header: "No liquidations",
      bodyText: (
        <>
          Leveraged tokens absorb temporary market pullbacks and "bounce".
          <br />
          <br />
          Perps can get liquidated under the same market conditions.
        </>
      ),
      src: noLiquidations,
    },
    {
      id: 4,
      header: "Constant leverage",
      bodyText: (
        <>
          In trending markets, leveraged tokens can outperform perps by
          compounding gains or minimizing losses.
        </>
      ),
      src: upDownLevering,
    },
    {
      id: 5,
      header: "What's the catch?",
      bodyText: (
        <>
          During prolonged choppy or sideways markets, frequent rebalancing can
          erode position value - resulting in volatility decay.
        </>
      ),
      src: volatilityDecay,
    },
    {
      id: 6,
      header: "Ready to Bounce?",
      bodyText: <>I understand the risks and am ready to trade.</>,
      src: readyToBounce,
    },
  ];

  const isLastStage = activeStage === primerStages.length - 1;

  const dismissPrimer = () => {
    markMintPrimerViewed();
    dispatch(closePrimerModal());
  };

  const showPrimer = isOpen && allowPageAccess;

  return (
    <Popup
      show={!!showPrimer}
      close={dismissPrimer}
      maxWidth={"36rem"}
      noPadding
      noGap
    >
      <div className={styles.outerContainer}>
        <Lottie
          animationData={primerStages[activeStage].src}
          loop={true}
          autoplay={true}
        />
        <div className={styles.primerContainer}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={activeStage}
              className={styles.primerTextBlock}
              variants={primerTextFade}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={primerTextFadeTransition}
            >
              <h2>{primerStages[activeStage].header}</h2>
              <p>{primerStages[activeStage].bodyText}</p>
            </motion.div>
          </AnimatePresence>
          <div className={styles.outerButtonContainer}>
            <div className={styles.buttonContainer}>
              <Button
                variant="navigation"
                onClick={() =>
                  setActiveStage((prev) =>
                    prev === 0 ? primerStages.length - 1 : prev - 1,
                  )
                }
                disabled={activeStage === 0}
                icon={
                  <Chevron
                    color="var(--primary-500-or-white)"
                    direction="left"
                  />
                }
                iconPosition="left"
              >
                Previous
              </Button>

              <motion.div
                layout
                className={styles.nextButtonSlot}
                transition={{
                  layout: { duration: 0.28, ease: [0.4, 0, 0.2, 1] },
                }}
              >
                <Button
                  variant={isLastStage ? "primary" : "navigation"}
                  onClick={() =>
                    isLastStage
                      ? dismissPrimer()
                      : setActiveStage((prev) => prev + 1)
                  }
                  icon={
                    isLastStage ? undefined : (
                      <Chevron
                        color="var(--primary-500-or-white)"
                        direction="right"
                      />
                    )
                  }
                  iconPosition="right"
                >
                  {isLastStage ? "Get Started" : "Next"}
                </Button>
              </motion.div>
            </div>
          </div>
        </div>
      </div>
    </Popup>
  );
};

export default PrimerModal;
