import { REFERRALS_ADDRESS, REFERRALS_ABI } from "@bouncetech/contracts";
import { useDispatch } from "react-redux";
import { usePublicClient, useWriteContract } from "wagmi";

import { setError } from "../../../state/errorSlice";
import waitForTransaction from "../../../utils/waitForTransaction.util";

const useJoinWithReferral = () => {
  const dispatch = useDispatch();

  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();

  const joinWithReferral = async (referralCode: string) => {
    try {
      const hash = await writeContractAsync({
        address: REFERRALS_ADDRESS,
        abi: REFERRALS_ABI,
        functionName: "joinWithReferral",
        args: [referralCode],
      });
      await waitForTransaction(publicClient, hash);
    } catch (err) {
      dispatch(
        setError({
          message:
            "There was an error whilst using referral code, please try again.",
          details: (err as Error).message,
        }),
      );
    }
  };

  return { joinWithReferral };
};

export default useJoinWithReferral;
