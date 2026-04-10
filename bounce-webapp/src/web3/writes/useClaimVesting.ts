import { useEffect } from "react";

import { useDispatch } from "react-redux";
import { useWaitForTransactionReceipt, useWriteContract } from "wagmi";

import { setError } from "../../state/errorSlice";
import VESTING_ABI from "../abis/vesting-abi.json";
import { VESTING_ADDRESS } from "../addresses";
import useBounceAccount from "../views/useBounceAccount";

const useClaimVesting = () => {
  const dispatch = useDispatch();
  const { address } = useBounceAccount();
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

  const claimVesting = async () => {
    await writeContractAsync({
      address: VESTING_ADDRESS,
      abi: VESTING_ABI,
      functionName: "claim",
      args: [address, address],
    });
  };

  useEffect(() => {
    if (error) {
      dispatch(
        setError({
          message:
            "There was an error whilst claiming vesting, please try again.",
          details: error.message,
        }),
      );
      return;
    }

    if (errorConfirming) {
      dispatch(
        setError({
          message:
            "There was an error whilst claiming vesting, please try again.",
          details: errorConfirming.message,
        }),
      );
      return;
    }
  }, [errorConfirming, error, dispatch]);

  return {
    claimVesting,
    isConnecting,
    isPending,
    isSuccess,
  };
};

export default useClaimVesting;
