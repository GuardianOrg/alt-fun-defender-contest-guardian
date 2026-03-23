import { erc20Abi, type Address } from "viem";

import useBounceAccount from "./useBounceAccount";
import useReadBounceContract from "./useReadBounceContract";
import { baseAsset } from "../../constants/baseAsset";

export function useBaseAssetApprovalBalance(spender: Address) {
  const { address } = useBounceAccount();

  const data = useReadBounceContract(
    !!address,
    true,
    baseAsset.address as Address,
    erc20Abi,
    "allowance",
    [address as Address, spender],
  );

  return data as bigint | null;
}
