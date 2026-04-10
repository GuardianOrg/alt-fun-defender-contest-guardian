import { useEffect, useState } from "react";

import { AnimatePresence, motion } from "framer-motion";

import styles from "./LiquidationPointsPage.module.css";
import { hasAddressOpened, addOpenedAddress } from "./localStorageUtils";
import { trackEvent } from "../../analytics/ga";
import AnimatePresenceHeight from "../../components/Global/AnimatePresenceHeight/AnimatePresenceHeight";
import CorePageContainer from "../../components/Global/CorePageContainer/CorePageContainer";
import CorePageTitle from "../../components/Global/CorePageTitle/CorePageTitle";
import Seo from "../../components/Global/Seo";
import Explorer from "../../components/LiquidationPointsPage/Explorer/Explorer";
import Leaderboard from "../../components/LiquidationPointsPage/Leaderboard/Leaderboard";
import LiquidationCardContainer from "../../components/LiquidationPointsPage/LiquidationCardContainer/LiquidationCardContainer";
import LiquidationJourneyContainer from "../../components/LiquidationPointsPage/LiquidationJourneyContainer/LiquidationJourneyContainer";
import { LiquidationsJourney } from "../../components/LiquidationPointsPage/LiquidationsJourney/LiquidationsJourney";
import LoadingCard from "../../components/LiquidationPointsPage/LoginCards/LoadingCard";
import PostLoginCard from "../../components/LiquidationPointsPage/LoginCards/PostLoginCard";
import PreLoginCard from "../../components/LiquidationPointsPage/LoginCards/PreLoginCard/PreLoginCard";
import StartTrading from "../../components/LiquidationPointsPage/StartTrading/StartTrading";
import StatsCard from "../../components/LiquidationPointsPage/StatsCard/StatsCard";
import useLiquidationJourneyData from "../../hooks/useLiquidationJourneyData";
import useBounceAccount from "../../web3/views/useBounceAccount";

type ViewState =
  | "prelogin"
  | "loading"
  | "postlogin"
  | "liquidationsWrappedPrompt"
  | "liquidationCards";

const LiquidationPointsPage = () => {
  const { address, isConnected } = useBounceAccount();
  const { data: liquidationJourneyData, isLoading } =
    useLiquidationJourneyData(address);

  // UI state
  const [claimedWithinSession, setClaimedWithinSession] = useState(false);
  const [showLiquidationsWrapped, setShowLiquidationsWrapped] = useState(false);

  // Derived state
  const hasBeenLiquidated =
    (liquidationJourneyData?.totalLiquidationNotional ?? 0) > 0;
  const hasClaimedScore =
    liquidationJourneyData?.hasClaimed || claimedWithinSession;
  const hasOpenedLiquidationsWrapped = hasAddressOpened(address);

  // Handlers
  const openLiquidationsWrapped = () => setShowLiquidationsWrapped(true);

  const handleCloseJourney = () => {
    setShowLiquidationsWrapped(false);

    if (address) {
      addOpenedAddress(address);
      trackEvent("viewed_liquidations_wrapped", {
        label: { address },
      });
    }
  };

  // Reset on wallet change
  useEffect(() => {
    setClaimedWithinSession(false);
  }, [address]);

  const viewState: ViewState = !isConnected
    ? "prelogin"
    : isLoading
      ? "loading"
      : !hasBeenLiquidated || !liquidationJourneyData
        ? "postlogin"
        : !hasOpenedLiquidationsWrapped
          ? "liquidationsWrappedPrompt"
          : "liquidationCards";

  const viewMap: Record<ViewState, React.ReactNode> = {
    prelogin: <PreLoginCard />,
    loading: <LoadingCard />,
    postlogin: <PostLoginCard />,
    liquidationsWrappedPrompt: (
      <LiquidationJourneyContainer
        openLiquidationsWrapped={openLiquidationsWrapped}
      />
    ),
    liquidationCards: (
      <LiquidationCardContainer
        userData={liquidationJourneyData!}
        hasClaimedScore={hasClaimedScore}
      />
    ),
  };

  return (
    <>
      <Seo
        title="Liquidation Score"
        description="Your Liquidation Score turns your worst trades into a badge of honour."
      />

      <CorePageContainer>
        {liquidationJourneyData &&
          liquidationJourneyData.totalLiquidationCount > 0 && (
            <LiquidationsJourney
              liquidationJourneyData={liquidationJourneyData}
              show={showLiquidationsWrapped}
              hasClaimedScore={hasClaimedScore}
              close={handleCloseJourney}
            />
          )}

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          style={{ width: "100%" }}
        >
          <CorePageTitle title="Liquidation" titleHighlight="Score" />
        </motion.div>

        <AnimatePresenceHeight
          shouldDisplay={!!hasClaimedScore && !!hasBeenLiquidated}
          className={styles.bannerContainer}
          duration={0.5}
        >
          <StartTrading />
        </AnimatePresenceHeight>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut", delay: 0.3 }}
          style={{ width: "100%", display: "flex", flex: 1 }}
        >
          <div className={styles.topRow}>
            <StatsCard
              userData={hasBeenLiquidated ? liquidationJourneyData : null}
              address={address}
              hasOpenedLiquidationsWrapped={hasOpenedLiquidationsWrapped}
              hasClaimedScore={hasClaimedScore}
              openLiquidationsWrapped={openLiquidationsWrapped}
              setClaimedWithinSession={setClaimedWithinSession}
            />

            <AnimatePresence mode="wait">
              <motion.div
                key={viewState}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.35 }}
                style={{ width: "100%" }}
              >
                {viewMap[viewState]}
              </motion.div>
            </AnimatePresence>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut", delay: 0.6 }}
          style={{ width: "100%" }}
        >
          <Leaderboard userData={liquidationJourneyData} />
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut", delay: 0.9 }}
          style={{ width: "100%" }}
        >
          <Explorer />
        </motion.div>
      </CorePageContainer>
    </>
  );
};

export default LiquidationPointsPage;
