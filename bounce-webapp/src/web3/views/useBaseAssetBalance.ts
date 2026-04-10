import { erc20Abi, type Address } from "viem";

import useBounceAccount from "./useBounceAccount";
import useReadBounceContract from "./useReadBounceContract";
import { baseAsset } from "../../constants/baseAsset";

export function useBaseAssetBalance() {
  const { address } = useBounceAccount();

  const data = useReadBounceContract(
    !!address,
    true,
    baseAsset.address as Address,
    erc20Abi,
    "balanceOf",
    [address as Address],
  );

  return data as bigint | null;
}
