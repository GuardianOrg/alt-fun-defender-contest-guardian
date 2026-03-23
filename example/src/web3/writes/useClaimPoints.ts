import { useEffect } from "react";

import { useDispatch } from "react-redux";
import { useWaitForTransactionReceipt, useWriteContract } from "wagmi";

import { setError } from "../../state/errorSlice";
import LIQUIDATION_ABI from "../abis/liquidation-points-abi.json";
import { LIQUIDATION_ADDRESS } from "../addresses";

const useClaimPoints = () => {
  const dispatch = useDispatch();
  const {
    data: hash,
    writeContractAsync,
    isPending: isConnecting,
    error,
  } = useWriteContract();

  const {
    isLoading: isPending,
    isSuccess,
    error: errorConfirming,
  } = useWaitForTransactionReceipt({ hash });

  const claimPoints = async () => {
    await writeContractAsync({
      address: LIQUIDATION_ADDRESS,
      abi: LIQUIDATION_ABI,
      functionName: "claimLiquidationPoints",
    });
  };

  // Surface errors
  useEffect(() => {
    if (error) {
      dispatch(
        setError({
          message:
            "There was an error whilst claiming points, please try again.",
          details: error.message,
        }),
      );
      return;
    }

    if (errorConfirming) {
      dispatch(
        setError({
          message:
            "There was an error whilst claiming points, please try again.",
          details: errorConfirming.message,
        }),
      );
      return;
    }
  }, [errorConfirming, error, dispatch]);

  return {
    claimPoints,
    isConnecting,
    isPending,
    isSuccess,
  };
};

export default useClaimPoints;
