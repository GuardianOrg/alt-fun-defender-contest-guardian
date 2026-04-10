import { useEffect, useState } from "react";

import RedeemButton from "./RedeemButton/RedeemButton";
import {
  calculateMinRedeemAmounts,
  getRedeemInputError,
} from "./redeemErrorUtils";
import RedeemInput from "./RedeemInput/RedeemInput";
import styles from "./RedeemModalContent.module.css";
import TokenInformation from "./TokenInformation/TokenInformation";
import TransactionInformationTable from "./TransactionInformationTable/TransactionInformationTable";
import { useGlobalStorageData } from "../../../../../hooks/Indexer/useGlobalStorage";
import { useLeveragedToken } from "../../../../../hooks/Indexer/useLeveragedToken";
import { bigIntToNumber } from "../../../../../utils/bigIntToNumber.util";
import { formatNumber } from "../../../../../utils/formatNumber.util";
import usePrepareRedeemTokens from "../../../../../web3/writes/usePrepareRedeemTokens";
import useRedeemTokens from "../../../../../web3/writes/useRedeemTokens";

import type { LeveragedTokenPnl } from "../../../../../hooks/Indexer/usePnl";
import type { LeveragedTokenData } from "../../../../../types/leverageTokenData";

const RedeemModalContent = ({
  leverageToken,
  pnl,
}: {
  leverageToken: LeveragedTokenData;
  pnl: LeveragedTokenPnl | null;
}) => {
  const globalStorageData = useGlobalStorageData();

  // can be removed once baseAssetBalance etc is live.
  const { data: liveLeverageToken } = useLeveragedToken(leverageToken.symbol);

  // Input state
  const [redeemInputValueBigInt, setRedeemInputValueBigInt] = useState<bigint>(
    BigInt(0),
  );
  const redeemInputValueNumber = bigIntToNumber(redeemInputValueBigInt, 18);

  // Redeem flow state
  const { estimatedRedeem, minimumRedeem, redeemTokens, refetch } =
    useRedeemTokens(
      redeemInputValueBigInt,
      leverageToken.address,
      leverageToken.targetLeverage,
      leverageToken.exchangeRate,
    );

  const { prepareRedeemTokens } = usePrepareRedeemTokens();

  // Input error
  const { minLeveragedTokenAmountBuffer } = calculateMinRedeemAmounts(
    globalStorageData,
    leverageToken,
  );
  const { inputError, errorMessage } = getRedeemInputError(
    redeemInputValueBigInt,
    leverageToken,
    minLeveragedTokenAmountBuffer,
  );

  // UI USDC values
  const exchangeRate = bigIntToNumber(
    liveLeverageToken?.exchangeRate || leverageToken.exchangeRate,
    18,
  );
  const usdcBalance =
    exchangeRate * bigIntToNumber(leverageToken.balanceOf, 18);
  const usdcClaimAmount = estimatedRedeem
    ? bigIntToNumber(estimatedRedeem, 6)
    : redeemInputValueNumber * exchangeRate;

  // Redeem flow logic
  const baseAssetBalance = bigIntToNumber(leverageToken.baseAssetBalance, 6);
  const redeemPendingFlowRequired = usdcClaimAmount > baseAssetBalance;

  const redeemPnl =
    pnl?.unrealized && usdcBalance > 0
      ? pnl.unrealized * (usdcClaimAmount / usdcBalance)
      : 0;

  // String formats
  const usdcBalanceEquivalent = formatNumber(usdcBalance);
  const usdcRedeemEquivalent = formatNumber(usdcClaimAmount);
  const usdcMinimumRedeemEquivalent = redeemPendingFlowRequired
    ? undefined
    : formatNumber(bigIntToNumber(minimumRedeem || 0n, 6));

  const feeAmount =
    usdcClaimAmount *
    bigIntToNumber(globalStorageData?.redemptionFee || 0n, 18) *
    leverageToken.targetLeverage;

  useEffect(() => {
    if (!leverageToken.exchangeRate) return;
    refetch();
  }, [leverageToken.exchangeRate, refetch]);

  return (
    <div className={styles.container}>
      <TokenInformation
        leverageToken={leverageToken}
        usdcBalanceEquivalent={usdcBalanceEquivalent}
      />
      <RedeemInput
        leverageToken={leverageToken}
        minLeveragedTokenAmountBuffer={minLeveragedTokenAmountBuffer}
        inputError={inputError}
        errorMessage={errorMessage}
        setRedeemValueBigInt={setRedeemInputValueBigInt}
      />
      <TransactionInformationTable
        usdcRedeemEquivalent={usdcRedeemEquivalent}
        usdcMinimumRedeemEquivalent={usdcMinimumRedeemEquivalent}
        redeemPendingFlowRequired={redeemPendingFlowRequired}
        redeemPnl={redeemPnl}
        feeAmount={feeAmount}
      />
      <RedeemButton
        redeemValueBigInt={redeemInputValueBigInt}
        leverageToken={leverageToken}
        redeemPendingFlowRequired={redeemPendingFlowRequired}
        inputError={inputError}
        redeemTokens={redeemTokens}
        prepareRedeemTokens={prepareRedeemTokens}
      />
    </div>
  );
};

export default RedeemModalContent;
