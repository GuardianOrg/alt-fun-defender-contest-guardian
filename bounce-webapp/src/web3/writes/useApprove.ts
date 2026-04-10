import { useDispatch } from "react-redux";
import { type Address, erc20Abi, maxUint256 } from "viem";
import { usePublicClient, useWriteContract } from "wagmi";

import {
  setPendingTransactionWarning,
  setStepperStage,
} from "../../state/mintSlice";
import waitForTransaction from "../../utils/waitForTransaction.util";

const useApprove = (tokenAddress: Address) => {
  const dispatch = useDispatch();
  const publicClient = usePublicClient();

  const { writeContractAsync } = useWriteContract();

  const approve = async (spender: Address, value?: bigint) => {
    const valueToApprove = value ?? maxUint256;
    dispatch(setPendingTransactionWarning(true));
    try {
      const hash = await writeContractAsync({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: "approve",
        args: [spender, valueToApprove],
      });
      await waitForTransaction(publicClient, hash);
      dispatch(setStepperStage("mintPending"));
    } catch (err) {
      dispatch(setPendingTransactionWarning(false));
      dispatch(setStepperStage("approvalError"));
      throw err;
    }
  };

  return approve;
};

export default useApprove;
