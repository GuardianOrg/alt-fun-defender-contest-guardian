import useLiquidationJourneyData from "./useLiquidationJourneyData";
import { useUserHasRegistered } from "./useUserHasRegistered";
import useBounceAccount from "../web3/views/useBounceAccount";

export const useAllowPageAccess = () => {
  const { address } = useBounceAccount();
  const { data: liquidationJourneyData } = useLiquidationJourneyData(address);
  const hasClaimedScore = liquidationJourneyData?.hasClaimed;
  const hasClaimedLiquidationScoreLocally = localStorage.getItem(
    "hasClaimedLiquidationScore",
  );
  const { hasRegistered } = useUserHasRegistered();

  return hasClaimedScore || hasRegistered || hasClaimedLiquidationScoreLocally;
};
