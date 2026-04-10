import { useDispatch, useSelector } from "react-redux";

import styles from "./RedeemButton.module.css";
import { trackEvent } from "../../../../../../analytics/ga";
import JellyLoader from "../../../../../../assets/JellyLoader";
import {
  selectRedeemButtonState,
  setRedeemButtonState,
} from "../../../../../../state/mintSlice";
import Button from "../../../../../Global/Buttons/Button";

import type { LeveragedTokenData } from "../../../../../../types/leverageTokenData";
import type { Address } from "viem";

interface RedeemButtonProps {
  redeemValueBigInt: bigint;
  leverageToken: LeveragedTokenData;
  redeemPendingFlowRequired: boolean;
  inputError: boolean;
  redeemTokens: () => Promise<void>;
  prepareRedeemTokens: (
    ltAmount: bigint,
    leverageTokenToRedeemAddress: Address,
  ) => Promise<void>;
}

const RedeemButton = ({
  redeemValueBigInt,
  leverageToken,
  redeemPendingFlowRequired,
  inputError,
  redeemTokens,
  prepareRedeemTokens,
}: RedeemButtonProps) => {
  const dispatch = useDispatch();

  const redeemButton = useSelector(selectRedeemButtonState);

  const handleRedeemClick = async () => {
    if (!redeemValueBigInt) return;
    dispatch(setRedeemButtonState("loading"));
    trackEvent("redeem_action", {
      label: "redeem_initiated",
    });

    await (redeemPendingFlowRequired
      ? prepareRedeemTokens(redeemValueBigInt, leverageToken.address)
      : redeemTokens());
  };

  const buttonDisabled =
    inputError || redeemValueBigInt === BigInt(0) || redeemButton === "loading";

  const CTA_LABELS: Record<"redeem" | "loading" | "tryAgain", React.ReactNode> =
    {
      redeem: "Redeem",
      loading: <JellyLoader color="var(--white)" />,
      tryAgain: "Try again",
    } as const;

  return (
    <>
      <div
        className={`${styles.redeemButtonContainer} ${
          buttonDisabled ? styles.disabled : ""
        }`}
      >
        <Button
          variant="primary"
          wide
          onClick={handleRedeemClick}
          disabled={buttonDisabled}
        >
          {CTA_LABELS[redeemButton]}
        </Button>
      </div>
    </>
  );
};

export default RedeemButton;
