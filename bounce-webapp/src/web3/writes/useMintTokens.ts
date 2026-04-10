import { LEVERAGED_TOKEN_ABI } from "@bouncetech/contracts";
import { useDispatch } from "react-redux";
import { type Address } from "viem";
import { useWriteContract, useSimulateContract, usePublicClient } from "wagmi";

import {
  setPendingTransactionWarning,
  setStepperStage,
} from "../../state/mintSlice";
import { addPendingTrade } from "../../state/transactionsSlice";
import waitForTransaction from "../../utils/waitForTransaction.util";
import { calculateMinOut } from "../utils/calculateMinOut";
import useBounceAccount from "../views/useBounceAccount";

import type { RefetchOptions } from "@tanstack/react-query";

export interface UseMintTokensResult {
  hash?: Address;
  simulatedEstimatedMint?: bigint;
  minimumMint: bigint;
  mintTokens: () => Promise<void>;
  refetch: (options?: RefetchOptions) => Promise<unknown>;
}

const useMintTokens = (
  baseAssetAmount: bigint,
  leverageTokenToMintAddress: Address,
  leverage: number,
  exchangeRate: bigint,
): UseMintTokensResult => {
  const { address } = useBounceAccount();
  const dispatch = useDispatch();
  const publicClient = usePublicClient();

  const { data: simulation, refetch } = useSimulateContract({
    address: leverageTokenToMintAddress,
    abi: LEVERAGED_TOKEN_ABI,
    functionName: "mint",
    args:
      address && baseAssetAmount ? [address, baseAssetAmount, 0n] : undefined,
    query: {
      enabled: Boolean(
        address && baseAssetAmount && leverageTokenToMintAddress,
      ),
    },
  });

  const baseAssetAmount18 = baseAssetAmount * 10n ** 12n;
  const estimatedOutputBigInt = (baseAssetAmount18 * 10n ** 18n) / exchangeRate;

  const minOut = calculateMinOut(
    simulation?.result || estimatedOutputBigInt,
    leverage,
  );

  const { data: hash, writeContractAsync } = useWriteContract();

  const mintTokens = async () => {
    if (!address || !baseAssetAmount) {
      dispatch(setStepperStage("mintError"));
      return;
    }

    dispatch(setPendingTransactionWarning(true));

    try {
      const txHash = await writeContractAsync({
        address: leverageTokenToMintAddress,
        abi: LEVERAGED_TOKEN_ABI,
        functionName: "mint",
        args: [address, baseAssetAmount, minOut],
      });
      await waitForTransaction(publicClient, txHash);
      dispatch(addPendingTrade({ txHash, type: "mint" }));
      dispatch(setStepperStage("mintExecuting"));
    } catch (err) {
      dispatch(setStepperStage("mintError"));
      throw err;
    } finally {
      dispatch(setPendingTransactionWarning(false));
    }
  };

  return {
    hash,
    simulatedEstimatedMint: simulation?.result,
    minimumMint: minOut,
    mintTokens,
    refetch,
  };
};

export default useMintTokens;
