import PnLCard from "./PnLCard/PnLCard";
import styles from "./PortfolioCards.module.css";
import RewardsCard from "./RewardsCard/RewardsCard";
import bounceToken from "../../../assets/bounce-token.svg";
import { useFeatureFlags } from "../../../config/featureFlags";
import { baseAsset } from "../../../constants/baseAsset";
import usePnl from "../../../hooks/Indexer/usePnl";

const PortfolioCards = () => {
  const { lockRoute, stakeRoute } = useFeatureFlags();
  const pnl = usePnl();

  return (
    <div className={styles.cards}>
      <PnLCard
        title={"Unrealized PnL"}
        tooltipContent="The current profit or loss from all open trades, based on the difference between the entry price and the market price."
        value={pnl?.totalUnrealized ?? null}
      />
      <PnLCard
        title={"Realized PnL"}
        tooltipContent={
          "The total profit or loss from all completed trades, including transaction fees."
        }
        value={pnl?.totalRealized ?? null}
      />
      {stakeRoute && (
        <RewardsCard
          title={"Stake Rewards"}
          tooltipContent="Coming soon"
          logo={baseAsset.logo}
          value={"0 USDC"}
          button={{ title: "Stake Bounce", link: "" }}
          // button copy to "claim" once there are rewards to claim
          subTitle="Total Stake Rewards Claimed"
          subAmount={"--"}
        />
      )}
      {lockRoute && (
        <RewardsCard
          title={"Lock Rewards"}
          tooltipContent="Coming soon"
          logo={bounceToken}
          value={"0 BOUNCE"}
          button={{ title: "Stake Bounce", link: "" }}
          // button copy to "claim" once there are rewards to claim
          subTitle="Total Lock Rewards Claimed"
          subAmount={"--"}
        />
      )}
    </div>
  );
};

export default PortfolioCards;
