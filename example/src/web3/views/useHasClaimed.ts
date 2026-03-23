import LIQUIDATION_ABI from "../abis/liquidation-points-abi.json";
import { LIQUIDATION_ADDRESS } from "../addresses";
import useReadBounceContract from "./useReadBounceContract";

import type { Address } from "viem";

const useHasClaimed = (address: Address | undefined): boolean => {
  const data = useReadBounceContract(
    !!address,
    true,
    LIQUIDATION_ADDRESS,
    LIQUIDATION_ABI,
    "hasClaimed",
    [address],
  );

  if (!address) return false;
  return data as boolean;
};

export default useHasClaimed;
