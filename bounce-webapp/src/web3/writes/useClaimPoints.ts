import { useState } from "react";

import { useDispatch } from "react-redux";
import { recoverMessageAddress } from "viem";
import { useSignMessage } from "wagmi";

import { setError } from "../../state/errorSlice";

const CLAIM_API_BASE = "https://api.bounce.tech/liquidations/claim";
const SIGN_MESSAGE = "bounce";

export interface ClaimPointsResponse {
  address: string;
  claimed: boolean;
  score: number;
}

const useClaimPoints = () => {
  const dispatch = useDispatch();
  const { signMessageAsync, isPending: isSigning } = useSignMessage();

  const [isClaiming, setIsClaiming] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const handleError = (message: string, details: string | null = null) => {
    dispatch(setError({ message, details }));
  };

  const claimPoints = async (): Promise<ClaimPointsResponse | null> => {
    if (isClaiming || isSigning) return null;

    try {
      setIsSuccess(false);
      setIsClaiming(true);

      const signature = await signMessageAsync({ message: SIGN_MESSAGE });
      if (!signature) return null;

      const recoveredAddress = await recoverMessageAddress({
        message: SIGN_MESSAGE,
        signature,
      });

      const url = `${CLAIM_API_BASE}/${encodeURIComponent(signature)}`;
      const res = await fetch(url);

      const errorMap: Record<number, { message: string; details?: string }> = {
        400: { message: "Invalid signature." },
        404: {
          message: "Address not found.",
          details: `Recovered address: ${recoveredAddress}`,
        },
        409: {
          message: "Already claimed.",
          details: "You have already claimed your liquidation score.",
        },
      };

      if (errorMap[res.status]) {
        const { message, details } = errorMap[res.status];
        handleError(message, details ?? null);
        return null;
      }

      if (!res.ok) {
        handleError(
          "There was an error whilst claiming your score, please try again.",
          await res.text().catch(() => null),
        );
        return null;
      }

      let data: ClaimPointsResponse;

      try {
        data = await res.json();
      } catch {
        handleError("Invalid response from server.");
        return null;
      }
      localStorage.setItem("hasClaimedLiquidationScore", "true");
      setIsSuccess(true);
      return data;
    } catch (err) {
      handleError(
        "There was an error whilst claiming your score, please try again.",
        err instanceof Error ? err.message : String(err),
      );
      return null;
    } finally {
      setIsClaiming(false);
    }
  };

  return {
    claimPoints,
    isConnecting: isSigning,
    isPending: isSigning || isClaiming,
    isSuccess,
  };
};

export default useClaimPoints;
