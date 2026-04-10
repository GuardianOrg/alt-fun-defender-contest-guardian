import { useEffect, useRef } from "react";

import { useQueryClient } from "@tanstack/react-query";
import confetti from "canvas-confetti";
import { useDispatch } from "react-redux";

import styles from "./Cards.module.css";
import { trackEvent } from "../../../../analytics/ga";
import { Liquidation } from "../../../../assets/Liquidation";
import { setError } from "../../../../state/errorSlice";
import useClaimPoints from "../../../../web3/writes/useClaimPoints";
import AnimatePresenceHeight from "../../../Global/AnimatePresenceHeight/AnimatePresenceHeight";
import Button from "../../../Global/Buttons/Button";
import InfoTooltip from "../../../Global/Tooltip/InfoTooltip";

import type { Address } from "viem";

interface ClaimPointsProps {
  score: string;
  address: Address | null;
  hasOpenedLiquidationsWrapped: boolean;
  hasClaimedScore: boolean;
  setClaimedWithinSession: (claimed: boolean) => void;
  openLiquidationsWrapped: () => void;
}

const ClaimPointsCard = ({
  score,
  address,
  hasOpenedLiquidationsWrapped,
  hasClaimedScore,
  setClaimedWithinSession,
  openLiquidationsWrapped,
}: ClaimPointsProps) => {
  const dispatch = useDispatch();
  const queryClient = useQueryClient();
  const { claimPoints, isConnecting, isPending, isSuccess } = useClaimPoints();

  const buttonRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isSuccess) {
      setClaimedWithinSession(true);

      // Refetch leaderboard and user journey so Leaderboard and stats show updated data
      queryClient.invalidateQueries({ queryKey: ["liquidations"] });
      if (address) {
        queryClient.invalidateQueries({
          queryKey: ["liquidation-journey-data", address],
        });
        trackEvent("claimed_liquidation_score", {
          label: { address },
        });
      }

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
  }, [isSuccess, queryClient, address, setClaimedWithinSession]);

  const handleClaimPoints = async () => {
    try {
      await claimPoints();
    } catch (error) {
      dispatch(
        setError({
          message: "There was a problem claiming your score, please try again.",
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
            Your liquidation score
          </h3>
          <InfoTooltip
            content={
              "Your claimable liquidation score is based on total amount liquidated, total number of liquidations, and recency of liquidations. Make sure you claim before the deadline!"
            }
          />
        </div>
        <div className={styles.valueContainer}>
          {Liquidation("var(--primary-text)")}
          <p
            className={`${styles.value} ${styles.claimValue} ${hasOpenedLiquidationsWrapped || hasClaimedScore ? "" : styles.blurred}`}
          >
            {score}
          </p>
        </div>
        <div ref={buttonRef}>
          <Button
            variant="primary"
            wide
            onClick={handleClaimPoints}
            loading={(isConnecting || isPending) && !isSuccess}
            disabled={
              hasClaimedScore ||
              isPending ||
              !hasOpenedLiquidationsWrapped ||
              !address
            }
          >
            {isPending && !isSuccess
              ? "Claim pending"
              : hasClaimedScore
                ? "Score claimed!"
                : "Claim your score"}
          </Button>

          <AnimatePresenceHeight
            shouldDisplay={!hasOpenedLiquidationsWrapped}
            duration={0.5}
          >
            <p className={styles.snapshot}>
              View Liquidations Wrapped to claim score
            </p>
          </AnimatePresenceHeight>

          <AnimatePresenceHeight
            shouldDisplay={hasOpenedLiquidationsWrapped}
            duration={0.5}
          >
            <button
              type="button"
              className={styles.replay}
              onClick={openLiquidationsWrapped}
            >
              Replay Liquidations Wrapped
            </button>
          </AnimatePresenceHeight>
        </div>
      </>
    </div>
  );
};

export default ClaimPointsCard;
