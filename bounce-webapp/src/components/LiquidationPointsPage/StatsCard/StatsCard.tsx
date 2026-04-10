import ClaimPointsCard from "./Cards/ClaimPointsCard";
import StatCard from "./Cards/StatCard";
import styles from "./StatsCard.module.css";
import useFormatAddress from "../../../hooks/useFormatAddress";
import { formatNumber } from "../../../utils/formatNumber.util";

import type { LiquidationJourneyData } from "../../../hooks/useLiquidationJourneyData";
import type { Address } from "viem";

interface StatsCardProps {
  userData: LiquidationJourneyData | null;
  address: Address | null;
  hasOpenedLiquidationsWrapped: boolean;
  hasClaimedScore: boolean;
  setClaimedWithinSession: (claimed: boolean) => void;
  openLiquidationsWrapped: () => void;
}

const StatsCard = ({
  userData,
  address,
  hasOpenedLiquidationsWrapped,
  hasClaimedScore,
  setClaimedWithinSession,
  openLiquidationsWrapped,
}: StatsCardProps) => {
  const liquidations = userData?.totalLiquidationNotional
    ? formatNumber(userData.totalLiquidationNotional, false, true)
    : "";
  const score = userData?.score?.toLocaleString() ?? "";
  const formattedAddress = useFormatAddress(address);

  return (
    <div className={`${styles.statsCard}`}>
      <StatCard
        title="Total HyperLiquid liquidations"
        value="$123.41B"
        tooltip="The total notional value of all liquidations that have occurred on Hyperliquid up until the snapshot date."
        snapshot="Snapshot taken on March 23, 2026"
      />
      <StatCard
        title="Your liquidations"
        value={liquidations}
        tooltip={`The total notional value of all liquidations on Hyperliquid for the connected wallet${
          address ? `: ${formattedAddress}` : ""
        } up until the snapshot date.`}
      />
      {userData?.score ? (
        <ClaimPointsCard
          score={score}
          address={address}
          hasOpenedLiquidationsWrapped={hasOpenedLiquidationsWrapped}
          hasClaimedScore={hasClaimedScore}
          setClaimedWithinSession={setClaimedWithinSession}
          openLiquidationsWrapped={openLiquidationsWrapped}
        />
      ) : (
        <StatCard
          title="Your liquidation score"
          value={score}
          tooltip={"Your claimable liquidation score."}
        />
      )}
    </div>
  );
};

export default StatsCard;
