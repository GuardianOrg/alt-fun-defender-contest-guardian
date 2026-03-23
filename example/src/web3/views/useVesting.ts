import VESTING_ABI from "../abis/vesting-abi.json";
import { VESTING_ADDRESS } from "../addresses";
import useBounceAccount from "./useBounceAccount";
import useReadBounceContract from "./useReadBounceContract";

import type { Address } from "viem";

export type VestingData = {
  start: bigint;
  end: bigint;
  amount: bigint;
  vested: bigint;
  claimed: bigint;
  claimable: bigint;
  revokedAt: bigint;
};

const useVesting = (): VestingData | null => {
  const { address } = useBounceAccount();

  const data = useReadBounceContract(
    !!address,
    true,
    VESTING_ADDRESS,
    VESTING_ABI,
    "data",
    [address as Address],
  );

  return data as VestingData | null;
};

export default useVesting;
