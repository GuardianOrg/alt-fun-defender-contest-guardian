import { useRef, useState } from "react";

import styles from "./LiquidationCardContainer.module.css";
import { LIQUIDATION_SCORE_ROUTE } from "../../../app/routes";
import { useReferralsData } from "../../../hooks/Indexer/useReferrals";
import {
  isAndroidWallet,
  isIOSWallet,
} from "../../../utils/sharecardUtils/getWalletType";
import { handleCopyImage } from "../../../utils/sharecardUtils/handleCopyImage";
import { handleSaveImage } from "../../../utils/sharecardUtils/handleSaveImage";
import Button from "../../Global/Buttons/Button";
import Toggle from "../../Global/Toggle/Toggle";
import Tooltip from "../../Global/Tooltip/Tooltip";
import LiquidationsShareCard from "../ShareCard/LiquidationsShareCard";

import type { LiquidationJourneyData } from "../../../hooks/useLiquidationJourneyData";

interface LiquidationCardProps {
  userData: LiquidationJourneyData;
  hasClaimedScore: boolean;
}

const LiquidationCardContainer = ({
  userData,
  hasClaimedScore,
}: LiquidationCardProps) => {
  const [copied, setCopied] = useState(false);
  const [isInPrivacyMode, setIsInPrivacyMode] = useState(false);
  const statsRef = useRef<HTMLDivElement>(null);
  const hideCopyButton = isIOSWallet() || isAndroidWallet();
  const { referralCode } = useReferralsData();

  const text = `I just claimed my liquidation score on @BounceTech!
  
If you've ever been liquidated, go claim your score! bounce.tech/${LIQUIDATION_SCORE_ROUTE}${
    referralCode ? `?ref=${referralCode}` : ""
  }`;

  const intentUrl = `https://twitter.com/intent/tweet?${new URLSearchParams({
    text,
  }).toString()}`;

  const buttons = (
    <div className={styles.buttonContainer}>
      <div className={styles.topButtons}>
        <Button
          variant="secondary"
          onClick={() =>
            handleSaveImage(statsRef, "Bounce-Liquidation-Score.png")
          }
          wide
          disabled={!hasClaimedScore}
        >
          Save Image
        </Button>

        {!hideCopyButton && (
          <Button
            variant="secondary"
            onClick={() => handleCopyImage(statsRef, setCopied)}
            wide
            noLoadingAnimation
            disabled={!hasClaimedScore}
          >
            {copied ? "Copied!" : "Copy Image"}
          </Button>
        )}
      </div>
      <a
        href={intentUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={styles.shareButton}
      >
        <Button variant="primary" wide disabled={!hasClaimedScore}>
          Share on X
        </Button>
      </a>
    </div>
  );

  return (
    <div className={styles.mainCard}>
      <div className={styles.refContainerMargin}>
        <div className={styles.refContainer} ref={statsRef}>
          <LiquidationsShareCard
            userData={userData}
            isInPrivacyMode={isInPrivacyMode}
          />
        </div>
      </div>

      <div className={styles.controlCard}>
        <div className={styles.buttonContainer}>
          <div className={styles.toggleContainer}>
            <span>Hide details</span>
            <Toggle
              ariaLabel={"Privacy Mode Toggle"}
              dataTestId="privacy-toggle"
              checked={isInPrivacyMode}
              onChange={() => setIsInPrivacyMode(!isInPrivacyMode)}
            />
          </div>

          {!hasClaimedScore ? (
            <Tooltip content="Claim your liquidation score to unlock sharing options">
              {buttons}
            </Tooltip>
          ) : (
            buttons
          )}
        </div>
      </div>
    </div>
  );
};

export default LiquidationCardContainer;
