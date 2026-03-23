import { motion } from "framer-motion";

import styles from "./LiquidationPointsPage.module.css";
import CorePageContainer from "../../components/Global/CorePageContainer/CorePageContainer";
import CorePageTitle from "../../components/Global/CorePageTitle/CorePageTitle";
import Seo from "../../components/Global/Seo";
import Leaderboard from "../../components/LiquidationPointsPage/Leaderboard/Leaderboard";
import LiquidationCardContainer from "../../components/LiquidationPointsPage/LiquidationCardContainer/LiquidationCardContainer";
import PostLoginCard from "../../components/LiquidationPointsPage/LoginCards/PostLoginCard";
import PreLoginCard from "../../components/LiquidationPointsPage/LoginCards/PreLoginCard";
import StatsCard from "../../components/LiquidationPointsPage/StatsCard/StatsCard";
import useLiquidationData from "../../hooks/useLiquidationData";
import useBounceAccount from "../../web3/views/useBounceAccount";

const LiquidationPointsPage = () => {
  const { address, isConnected } = useBounceAccount();
  const liquidationData = useLiquidationData();

  const userData = liquidationData?.find((entry) => !!entry.you);

  const leaderboardArray = liquidationData
    ?.filter((data) => data.claimed)
    .sort((a, b) => b.points - a.points);

  return (
    <>
      <Seo
        title="Liquidation Points"
        description="Liquidation Points turn your worst trades into a badge of honour."
      />

      <CorePageContainer>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          style={{ width: "100%" }}
        >
          <CorePageTitle title="Liquidation" titleHighlight="Points" />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut", delay: 0.3 }}
          style={{ width: "100%" }}
        >
          <div className={styles.topRow}>
            <StatsCard userData={userData} address={address} />
            {isConnected ? (
              userData && userData?.liquidations !== 0 ? (
                <LiquidationCardContainer userData={userData} />
              ) : (
                <PostLoginCard />
              )
            ) : (
              <PreLoginCard />
            )}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut", delay: 0.6 }}
          style={{ width: "100%" }}
        >
          <Leaderboard
            userData={userData}
            leaderboardArray={leaderboardArray}
          />
        </motion.div>
      </CorePageContainer>
    </>
  );
};

export default LiquidationPointsPage;
