import { DialPointer } from "./DialPointer";
import styles from "./LiquidationsShareCard.module.css";
import { HyperliquidFullLogo } from "../../../assets/Hyperliquid/HyperliquidFullLogo";
import dial from "../../../assets/liquidation-journey/dial.png";
import background from "../../../assets/liquidation-journey/sharecard.webp";
import { Logo } from "../../../assets/Logo";
import { formatNumber } from "../../../utils/formatNumber.util";
import {
  getAssetLogoUrl,
  getHasLogo,
} from "../LiquidationsJourney/Cards/assetLogos";
import { scoreToDegrees } from "../LiquidationsJourney/Cards/Card6/scoreToRotation.util";

import type { LiquidationJourneyData } from "../../../hooks/useLiquidationJourneyData";

interface LiquidationsShareCardProps {
  userData: LiquidationJourneyData;
  isInPrivacyMode: boolean;
}

const LiquidationsShareCard = ({
  userData,
  isInPrivacyMode,
}: LiquidationsShareCardProps) => {
  const sortedAssets = [...userData.assets].sort(
    (a, b) => b.totalLiquidationNotional - a.totalLiquidationNotional,
  );

  const shouldCollapse = sortedAssets.length > 4;

  const visibleAssets = shouldCollapse
    ? sortedAssets.slice(0, 3)
    : sortedAssets;

  const remainingCount = shouldCollapse ? sortedAssets.length - 3 : 0;
  const rotationDegrees = scoreToDegrees(userData.score) - 90;

  return (
    <div className={styles.refDiv}>
      <div className={styles.shareCard}>
        <img
          src={background}
          alt="Background mask"
          className={styles.shareCardBg}
          decoding="sync"
          loading="eager"
        />
        <div className={styles.mainContent}>
          <div
            className={styles.columnContainer}
            data-privacy={isInPrivacyMode ? "true" : "false"}
          >
            <span className={styles.shareCardTitle}>
              <HyperliquidFullLogo color={"var(--hl-foam)"} size={"21cqw"} />
              Liquidations Wrapped
            </span>
            <div
              className={`${styles.totalLiquidatedSection} ${isInPrivacyMode ? styles.totalLiquidatedSectionHidden : ""}`}
              aria-hidden={isInPrivacyMode}
            >
              <span className={styles.totalLiquidationTitle}>
                Total Liquidated
              </span>
              <span className={styles.totalLiquidationValue}>
                {formatNumber(userData.totalLiquidationNotional, false, true)}
              </span>
            </div>
            <span className={styles.topAssetsTitle}>Top Assets</span>
            <div className={styles.assetsContainer}>
              {visibleAssets.map((asset) => (
                <div key={asset.asset} className={styles.tokenImageContainer}>
                  {getHasLogo(asset.asset) ? (
                    <img
                      className={styles.tokenImage}
                      src={getAssetLogoUrl(asset.asset)}
                      alt={asset.asset}
                    />
                  ) : (
                    <span className={styles.tokenFallback}>{asset.asset}</span>
                  )}
                </div>
              ))}
              {remainingCount > 0 && (
                <div className={`${styles.tokenImageContainer} ${styles.glow}`}>
                  <span>+{remainingCount}</span>
                </div>
              )}
            </div>

            <span className={styles.liquidationScoreTitle}>
              Liquidation Score
            </span>
            <div className={styles.liquidationScore}>{userData.score}</div>
          </div>
          <div className={styles.dialWrapper}>
            <img
              src={dial}
              alt="Dial"
              className={styles.dialImage}
              decoding="sync"
              loading="eager"
            />

            <div className={styles.arrowOverlay}>
              <DialPointer rotation={rotationDegrees} />
            </div>
          </div>
        </div>
        <div className={styles.footer}>
          <div>
            <p className={styles.referralCode}>
              Claim rewards for your past liquidations:
            </p>
            <p className={styles.referralCodeValue}>
              bounce.tech/liquidation-score
            </p>
          </div>
          <div className={styles.logoContainer}>
            <Logo color="var(--hl-foam)" size="100%" />
          </div>
        </div>
      </div>
    </div>
  );
};

export default LiquidationsShareCard;
