import ClaimPointsCard from "./Cards/ClaimPointsCard";
import StatCard from "./Cards/StatCard";
import styles from "./StatsCard.module.css";
import useFormatAddress from "../../../hooks/useFormatAddress";

import type { LiquidationData } from "../../../hooks/useLiquidationData";
import type { Address } from "viem";

interface StatsCardProps {
  userData?: LiquidationData;
  address?: Address | null;
}

const StatsCard = ({ userData, address }: StatsCardProps) => {
  const liquidations = userData?.liquidations
    ? `$${userData?.liquidations.toLocaleString()}`
    : "";
  const points = userData?.points ? userData?.points.toLocaleString() : "";
  const formattedAddress = useFormatAddress(address ?? null);

  return (
    <div className={`${styles.statsCard}`}>
      <StatCard
        title="Total HyperLiquid liquidations"
        value="$16,430,000.32"
        tooltip="The total notional value in USD of all liquidations that have occurred on Hyperliquid up until the snapshot date."
        snapshot="Snapshot taken on 23/11/2025"
      />
      <StatCard
        title="Your liquidations"
        value={liquidations}
        tooltip={`The total notional value in USD of all liquidations on Hyperliquid for the connected wallet${
          address ? `: ${formattedAddress}` : ""
        } up until the snapshot date.`}
      />
      {userData?.points ? (
        <ClaimPointsCard
          title="Your liquidation points"
          value={points}
          tooltip="Your claimable liquidation points. Ensure you claim them with the button below before the deadline."
          claimed={userData.claimed}
        />
      ) : (
        <StatCard
          title="Your liquidation points"
          value={points}
          tooltip={"Your claimable liquidation points."}
        />
      )}
    </div>
  );
};

export default StatsCard;
