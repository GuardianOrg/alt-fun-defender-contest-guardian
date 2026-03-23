import { REFERRALS_ADDRESS, REFERRALS_ABI } from "@bouncetech/contracts";
import { useDispatch } from "react-redux";
import { usePublicClient, useWriteContract } from "wagmi";

import { setError } from "../../../state/errorSlice";
import waitForTransaction from "../../../utils/waitForTransaction.util";
import useBounceAccount from "../../views/useBounceAccount";

const useClaimRebates = () => {
  const dispatch = useDispatch();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const { address } = useBounceAccount();

  const claimRebates = async () => {
    try {
      if (!address) {
        dispatch(
          setError({
            message: "Please connect your wallet to claim rewards.",
            details: null,
          }),
        );
        return;
      }
      const hash = await writeContractAsync({
        address: REFERRALS_ADDRESS,
        abi: REFERRALS_ABI,
        functionName: "claimRebates",
        args: [address],
      });
      await waitForTransaction(publicClient, hash);
    } catch (err) {
      dispatch(
        setError({
          message:
            "There was an error whilst claiming rewards, please try again.",
          details: (err as Error).message,
        }),
      );
    }
  };

  return { claimRebates };
};

export default useClaimRebates;
