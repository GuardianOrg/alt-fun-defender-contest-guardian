import { useEffect } from "react";

import { Step, StepLabel, Stepper } from "@mui/material";
import { useDispatch, useSelector } from "react-redux";

import styles from "./ApprovalStepper.module.css";
import CustomStepIcon from "./CustomStepIcon/CustomStepIcon";
import { useMintFlow } from "./useMintFlow";
import { trackEvent } from "../../../../../analytics/ga";
import JellyLoader from "../../../../../assets/JellyLoader";
import {
  selectMintedAmountBigInt,
  selectStepperStage,
  setStepperStage,
  type StepperStage,
} from "../../../../../state/mintSlice";
import AnimatePresenceHeight from "../../../../Global/AnimatePresenceHeight/AnimatePresenceHeight";
import Button from "../../../../Global/Buttons/Button";

import type { LeveragedTokenData } from "../../../../../types/leverageTokenData";
import type { MintModalStates } from "../../../MintForm/MintForm";

interface ApprovalStepperProps {
  mintAmount: bigint;
  leverageToken: LeveragedTokenData;
  mintTokens: () => Promise<void>;
  setMintModalStage: (stage: MintModalStates) => void;
  setMintValue: (value: string) => void;
  setMintValueBigInt: (value: bigint | null) => void;
}

const ApprovalStepper = ({
  mintAmount,
  leverageToken,
  mintTokens,
  setMintModalStage,
  setMintValue,
  setMintValueBigInt,
}: ApprovalStepperProps) => {
  const dispatch = useDispatch();

  const mintedAmountBigInt = useSelector(selectMintedAmountBigInt);
  const stepperStage = useSelector(selectStepperStage);

  const activeStep = stepperStage.startsWith("approval") ? 0 : 1;

  const { handleMintFlow } = useMintFlow({
    mintAmount,
    leverageToken,
    mintTokens,
  });

  useEffect(() => {
    if (mintedAmountBigInt !== null) {
      dispatch(setStepperStage("mintSuccess"));
      setMintModalStage("success");
      setMintValue("");
      setMintValueBigInt(null);
      trackEvent("mint_action", {
        label: "mint_successful",
      });
    }
  }, [
    mintedAmountBigInt,
    setMintModalStage,
    setMintValue,
    setMintValueBigInt,
    dispatch,
  ]);

  const CTA_LABELS: Record<StepperStage, React.ReactNode> = {
    initial: "Mint",
    approvalPending: <JellyLoader color="var(--white)" />,
    approvalError: "Try again",
    mintPending: <JellyLoader color="var(--white)" />,
    mintError: "Try again",
    mintSuccess: <JellyLoader color="var(--white)" />,
    mintExecuting: <JellyLoader color="var(--white)" />,
  } as const;
  const buttonDisabled =
    stepperStage === "approvalPending" ||
    stepperStage === "mintPending" ||
    stepperStage === "mintSuccess" ||
    stepperStage === "mintExecuting";

  return (
    <div className={styles.approvalStepper}>
      <div
        className={`${styles.buttonContainer} ${
          buttonDisabled ? styles.disabled : ""
        }`}
      >
        <Button
          variant="primary"
          wide
          onClick={async () => {
            trackEvent("mint_action", {
              label: "mint_initiated",
            });
            await handleMintFlow();
          }}
          disabled={buttonDisabled}
        >
          {CTA_LABELS[stepperStage]}
        </Button>
      </div>
      <AnimatePresenceHeight
        shouldDisplay={stepperStage !== "initial"}
        className={styles.tokenInformationDropdownContent}
      >
        <Stepper
          activeStep={activeStep}
          orientation="vertical"
          className={styles.stepper}
        >
          <Step>
            <StepLabel
              className={styles.stepLabel}
              slots={{ stepIcon: CustomStepIcon }}
            >
              Approve transaction{" "}
              {stepperStage === "approvalPending" && (
                <span className={styles.stepLabelPending}>Signing</span>
              )}
              {stepperStage === "approvalError" && (
                <span className={styles.stepLabelError}>Error</span>
              )}
              {stepperStage === "mintPending" ||
              stepperStage === "mintError" ||
              stepperStage === "mintSuccess" ||
              stepperStage === "mintExecuting" ? (
                <span className={styles.stepLabelSuccess}>Success</span>
              ) : null}
            </StepLabel>
          </Step>
          <Step>
            <StepLabel className={styles.stepLabel}>
              Sign transaction{" "}
              {stepperStage === "mintPending" && (
                <span className={styles.stepLabelPending}>Signing</span>
              )}
              {stepperStage === "mintExecuting" && (
                <span className={styles.stepLabelPending}>Executing</span>
              )}
              {stepperStage === "mintError" && (
                <span className={styles.stepLabelError}>Error</span>
              )}
              {stepperStage === "mintSuccess" && (
                <span className={styles.stepLabelSuccess}>Success</span>
              )}
            </StepLabel>
          </Step>
        </Stepper>
      </AnimatePresenceHeight>
    </div>
  );
};

export default ApprovalStepper;
