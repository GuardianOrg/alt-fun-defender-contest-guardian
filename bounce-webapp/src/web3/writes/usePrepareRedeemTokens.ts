import { LEVERAGED_TOKEN_ABI } from "@bouncetech/contracts";
import { useDispatch } from "react-redux";
import { usePublicClient, useWriteContract } from "wagmi";

import {
  setLatestRedeemHash,
  setRedeemButtonState,
  setTransactionProcessing,
} from "../../state/mintSlice";
import { addPendingTrade } from "../../state/transactionsSlice";
import waitForTransaction from "../../utils/waitForTransaction.util";

import type { Address } from "viem";

const usePrepareRedeemTokens = () => {
  const dispatch = useDispatch();
  const publicClient = usePublicClient();

  const { writeContractAsync } = useWriteContract();

  const prepareRedeemTokens = async (
    ltAmount: bigint,
    leverageTokenToRedeemAddress: Address,
  ) => {
    try {
      const txHash = await writeContractAsync({
        address: leverageTokenToRedeemAddress,
        abi: LEVERAGED_TOKEN_ABI,
        functionName: "prepareRedeem",
        args: [ltAmount],
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
    prepareRedeemTokens,
  };
};

export default usePrepareRedeemTokens;
