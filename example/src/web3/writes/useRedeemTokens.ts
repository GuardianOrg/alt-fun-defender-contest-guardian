import { LEVERAGED_TOKEN_ABI } from "@bouncetech/contracts";
import { useDispatch } from "react-redux";
import { useWriteContract, usePublicClient, useSimulateContract } from "wagmi";

import {
  setLatestRedeemHash,
  setRedeemButtonState,
  setTransactionProcessing,
} from "../../state/mintSlice";
import { addPendingTrade } from "../../state/transactionsSlice";
import waitForTransaction from "../../utils/waitForTransaction.util";
import { calculateMinOut } from "../utils/calculateMinOut";
import useBounceAccount from "../views/useBounceAccount";

import type { Address } from "viem";

const useRedeemTokens = (
  ltAmount: bigint,
  leverageTokenToRedeemAddress: Address,
  leverage: number,
  exchangeRate: bigint,
) => {
  const dispatch = useDispatch();
  const { address } = useBounceAccount();
  const publicClient = usePublicClient();

  const { data: simulation, refetch } = useSimulateContract({
    address: leverageTokenToRedeemAddress,
    abi: LEVERAGED_TOKEN_ABI,
    functionName: "redeem",
    args: address && ltAmount ? [address, ltAmount, BigInt(0)] : undefined,
    query: {
      enabled: Boolean(address && ltAmount && leverageTokenToRedeemAddress),
    },
  });

  const estimatedResult = (ltAmount * exchangeRate) / 10n ** 12n / 10n ** 18n;

  const minOut = calculateMinOut(
    simulation?.result || estimatedResult,
    leverage,
  );

  const { writeContractAsync } = useWriteContract();

  const redeemTokens = async () => {
    if (!address || !ltAmount) {
      dispatch(setRedeemButtonState("tryAgain"));
      return;
    }

    try {
      const txHash = await writeContractAsync({
        address: leverageTokenToRedeemAddress,
        abi: LEVERAGED_TOKEN_ABI,
        functionName: "redeem",
        args: [address, ltAmount, minOut],
      });
      await waitForTransaction(publicClient, txHash);
      dispatch(addPendingTrade({ txHash, type: "redeem" }));
      dispatch(setTransactionProcessing(true));
      dispatch(setLatestRedeemHash(txHash));
    } catch (err) {
      dispatch(setRedeemButtonState("tryAgain"));
      throw err;
    }
  };

  return {
    estimatedRedeem: simulation?.result as bigint | undefined,
    minimumRedeem: minOut,
    redeemTokens,
    refetch,
  };
};

export default useRedeemTokens;
