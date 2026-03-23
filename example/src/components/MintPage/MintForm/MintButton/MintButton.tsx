import React from "react";

import { useDispatch } from "react-redux";

import styles from "./MintButton.module.css";
import { trackEvent } from "../../../../analytics/ga";
import { useIsUserBlocked } from "../../../../hooks/useIsUserBlocked";
import {
  setMintedAmountBigInt,
  setStepperStage,
} from "../../../../state/mintSlice";
import Button from "../../../Global/Buttons/Button";

import type { MintModalStates } from "../MintForm";

interface MintButtonProps {
  mintValueNumber: number | null;
  isConnected: boolean;
  inputError: boolean;
  leveragedTokenSelected: boolean;
  pendingTransactionWarning: boolean;
  leverageTokenSymbol: string;
  setMintModalStage: (stage: MintModalStates) => void;
}

const MintButton = ({
  mintValueNumber,
  isConnected,
  inputError,
  leveragedTokenSelected,
  pendingTransactionWarning,
  leverageTokenSymbol,
  setMintModalStage,
}: MintButtonProps) => {
  const dispatch = useDispatch();
  const { isUserBlocked } = useIsUserBlocked();

  const buttonDisabled =
    isUserBlocked ||
    (!mintValueNumber && isConnected) ||
    !!inputError ||
    (!leveragedTokenSelected && isConnected) ||
    pendingTransactionWarning;

  const openMintModal = () => {
    dispatch(setMintedAmountBigInt(null));
    dispatch(setStepperStage("initial"));
    setMintModalStage("confirm");
  };

  return (
    <div
      className={`${styles.submitButton} ${
        buttonDisabled ? styles.disabled : ""
      }`}
    >
      <Button
        variant="primary"
        addressRequired
        wide
        disabled={buttonDisabled}
        onClick={() => {
          openMintModal();
          trackEvent("mint_action", {
            label: "mint_modal_opened",
          });
        }}
      >
        Mint {leverageTokenSymbol}
      </Button>
    </div>
  );
};

export default React.memo(MintButton);
