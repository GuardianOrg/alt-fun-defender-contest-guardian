import { useRef, useState } from "react";

import styles from "./LiquidationCardContainer.module.css";
import { OVERLAYS, type OverlayKey } from "./liquidationOverlays";
import OverlaySelector from "./OverlaySelector";
import LiquidationCard from "./StatsCard/LiquidationCard";
import { LIQUIDATION_POINTS_ROUTE } from "../../../app/routes";
import bgSquare from "../../../assets/liquidation-points/bg-square.webp";
import noSelection from "../../../assets/no-selection.svg";
import { handleCopyImage } from "../../../utils/sharecardUtils/handleCopyImage";
import { handleSaveImage } from "../../../utils/sharecardUtils/handleSaveImage";
import Button from "../../Global/Buttons/Button";

import type { LiquidationData } from "../../../hooks/useLiquidationData";

interface LiquidationCardProps {
  userData?: LiquidationData;
}

const LiquidationCardContainer = ({ userData }: LiquidationCardProps) => {
  const [overlay, setOverlay] = useState<OverlayKey | "none">("none");
  const [copied, setCopied] = useState(false);
  const statsRef = useRef<HTMLDivElement>(null);

  const text = `I've been liquidated for $${
    userData?.liquidations || 0
  } trading on @HyperliquidX and just claimed ${
    userData?.points || 0
  } liquidation points on @BounceTech!
  
If you've ever been liquidated, go claim your points! bounce.tech/${LIQUIDATION_POINTS_ROUTE}`;

  const intentUrl = `https://twitter.com/intent/tweet?${new URLSearchParams({
    text,
  }).toString()}`;

  return (
    <div className={styles.mainCard}>
      <div className={styles.refContainerMargin}>
        <div className={styles.refContainer} ref={statsRef}>
          <LiquidationCard
            userData={userData}
            activeOverlay={overlay}
            overlays={OVERLAYS}
          />
        </div>
      </div>

      <div className={styles.controlCard}>
        <OverlaySelector
          activeOverlay={overlay}
          onChange={setOverlay}
          overlays={OVERLAYS}
          bgSquare={bgSquare}
          noSelection={noSelection}
        />

        <div className={styles.buttonContainer}>
          <div className={styles.topButtons}>
            <Button
              variant="secondary"
              onClick={() => handleSaveImage(statsRef)}
              wide
            >
              Save Image
            </Button>
            <Button
              variant="secondary"
              onClick={() => handleCopyImage(statsRef, setCopied)}
              wide
              noLoadingAnimation
            >
              {copied ? "Copied!" : "Copy Image"}
            </Button>
          </div>
          <a
            href={intentUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.shareButton}
          >
            <Button variant="primary" wide>
              Share on X
            </Button>
          </a>
        </div>
      </div>
    </div>
  );
};

export default LiquidationCardContainer;
