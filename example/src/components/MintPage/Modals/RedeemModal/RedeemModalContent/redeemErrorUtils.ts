import { bigIntToNumber } from "../../../../../utils/bigIntToNumber.util";
import { formatNumber } from "../../../../../utils/formatNumber.util";
import { numberToBigInt } from "../../../../../utils/numberToBigInt.util";

import type { GlobalStorageData } from "../../../../../hooks/Indexer/useGlobalStorage";
import type { LeveragedTokenData } from "../../../../../types/leverageTokenData";

export function getRedeemInputError(
  redeemValueBigInt: bigint | null,
  leverageToken: LeveragedTokenData,
  minLeveragedTokenAmountBuffer: number,
): { inputError: boolean; errorMessage?: string } {
  if (!redeemValueBigInt) return { inputError: false };

  const tooHigh = redeemValueBigInt > leverageToken.balanceOf;
  const tooLow =
    redeemValueBigInt < numberToBigInt(minLeveragedTokenAmountBuffer, 18);

  const inputError = tooHigh || tooLow;
  const errorMessage = tooHigh
    ? "Insufficient funds"
    : tooLow
      ? `Minimum redeem amount is ${formatNumber(
          minLeveragedTokenAmountBuffer,
        )} ${leverageToken.symbol}`
      : undefined;

  return { inputError, errorMessage };
}

export function calculateMinRedeemAmounts(
  globalStorageData: GlobalStorageData,
  leverageToken: LeveragedTokenData,
) {
  if (!globalStorageData || !leverageToken) {
    return {
      minLeveragedTokenAmountBuffer: 0,
    };
  }

  const minimumTransactionSize = bigIntToNumber(
    globalStorageData?.minTransactionSize,
    6,
  );
  const redemptionFee = bigIntToNumber(globalStorageData?.redemptionFee, 18);
  const targetLeverage = leverageToken.targetLeverage;
  const exchangeRate = bigIntToNumber(leverageToken.exchangeRate, 18);
  const minBaseAssetAmount =
    minimumTransactionSize / (1 - redemptionFee * targetLeverage);
  const minLeveragedTokenAmount = minBaseAssetAmount / exchangeRate;
  const MIN_REDEEM_BUFFER = 1.05;
  const minLeveragedTokenAmountBuffer =
    minLeveragedTokenAmount * MIN_REDEEM_BUFFER;

  return {
    minLeveragedTokenAmountBuffer,
  };
}
