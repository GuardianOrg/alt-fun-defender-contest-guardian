import LIQUIDATION_ABI from "../abis/liquidation-points-abi.json";
import { LIQUIDATION_ADDRESS } from "../addresses";
import useReadBounceContract from "./useReadBounceContract";

import type { Address } from "viem";

const useClaimed = (): Address[] | null => {
  const data = useReadBounceContract(
    true,
    true,
    LIQUIDATION_ADDRESS,
    LIQUIDATION_ABI,
    "users",
  );

  return data as Address[] | null;
};

export default useClaimed;
