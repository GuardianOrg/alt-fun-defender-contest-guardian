import { useEffect, useRef, useState } from "react";

import confetti from "canvas-confetti";
import { useDispatch } from "react-redux";

import styles from "./Cards.module.css";
import { Liquidation } from "../../../../assets/Liquidation";
import { setError } from "../../../../state/errorSlice";
import useClaimPoints from "../../../../web3/writes/useClaimPoints";
import Button from "../../../Global/Buttons/Button";
import InfoTooltip from "../../../Global/Tooltip/InfoTooltip";

interface ClaimPointsProps {
  title: string;
  tooltip: string;
  value?: string;
  claimed?: boolean;
}

const ClaimPointsCard = ({
  title,
  value,
  tooltip,
  claimed,
}: ClaimPointsProps) => {
  const dispatch = useDispatch();
  const { claimPoints, isConnecting, isPending, isSuccess } = useClaimPoints();
  const [claimedWithinSession, setClaimedWithinSession] = useState(claimed);

  const buttonRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isSuccess) {
      setClaimedWithinSession(true);

      if (buttonRef.current) {
        const rect = buttonRef.current.getBoundingClientRect();
        const x = (rect.left + rect.width / 2) / window.innerWidth;
        const y = (rect.top + rect.height / 2) / window.innerHeight;

        confetti({
          particleCount: 200,
          spread: 90,
          origin: { x, y },
          colors: ["#6753f1", "#ece3ff", "#dcebff", "#f3f3f7", "#8f8f9c"],
          scalar: 1.5,
          startVelocity: 60,
        });
      }
    }
  }, [isSuccess]);

  const handleClaimPoints = async () => {
    try {
      await claimPoints();
    } catch (error) {
      dispatch(
        setError({
          message:
            "There was a problem claiming your points, please try again.",
          details: (error as Error).message,
        }),
      );
    }
  };

  return (
    <div className={`${styles.card} ${styles.claimCard}`}>
      <>
        <div className={styles.cardTitleContainer}>
          <h3 className={`${styles.cardTitle} ${styles.claimCardTitle}`}>
            {title}
          </h3>
          <InfoTooltip content={tooltip} />
        </div>
        <div className={styles.valueContainer}>
          {Liquidation(
            `${
              claimedWithinSession
                ? "var(--primary-text)"
                : "var(--primary-300-or-grey-400)"
            }`,
          )}
          <p
            className={`${styles.value} ${styles.claimValue} ${
              !claimedWithinSession ? styles.unClaimed : ""
            }`}
          >
            {value}
          </p>
        </div>
        <div ref={buttonRef}>
          <Button
            variant="primary"
            wide
            onClick={handleClaimPoints}
            loading={isConnecting}
            disabled={claimedWithinSession || isPending}
          >
            {isPending
              ? "Claim pending"
              : claimedWithinSession
                ? "Points claimed!"
                : "Claim your points"}
          </Button>
        </div>
        <p className={styles.snapshot}>
          Requires gas for an onchain transaction
        </p>
      </>
    </div>
  );
};

export default ClaimPointsCard;
