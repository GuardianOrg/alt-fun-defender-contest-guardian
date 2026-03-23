import {
  LEVERAGED_TOKEN_HELPER_ABI,
  LEVERAGED_TOKEN_HELPER_ADDRESS,
} from "@bouncetech/contracts";

import useBounceAccount from "./useBounceAccount";
import useReadBounceContract from "./useReadBounceContract";
import { bigIntToNumber } from "../../utils/bigIntToNumber.util";
import { getLeverageTokenSymbol } from "../../utils/getLeverageTokenSymbol.util";

import type {
  LeveragedTokenData,
  LeveragedTokenDataRaw,
} from "../../types/leverageTokenData";

const useUsersLeveragedTokens = (onlyHeld: boolean = true) => {
  const { address } = useBounceAccount();

  const rawData = useReadBounceContract(
    !!address,
    true,
    LEVERAGED_TOKEN_HELPER_ADDRESS,
    LEVERAGED_TOKEN_HELPER_ABI,
    "getLeveragedTokens",
    [address, onlyHeld],
  ) as LeveragedTokenDataRaw[] | null;

  const enrichedData: LeveragedTokenData[] | null =
    rawData?.map((token) => {
      const leverage = bigIntToNumber(token.targetLeverage, 18);

      return {
        ...token,
        targetLeverage: leverage,
        address: token.leveragedToken,
        symbol: getLeverageTokenSymbol(
          token.targetAsset,
          leverage,
          token.isLong ? "long" : "short",
        ),
      };
    }) ?? null;

  return enrichedData as LeveragedTokenData[] | null;
};

export default useUsersLeveragedTokens;
