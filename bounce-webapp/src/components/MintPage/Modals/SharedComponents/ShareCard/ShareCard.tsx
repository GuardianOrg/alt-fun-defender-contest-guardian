import styles from "./ShareCard.module.css";
import LeveragedToken from "../../../../../assets/LeveragedToken/LeveragedToken";
import sharecardGraphicPng from "../../../../../assets/sharecard-graphic.png";
import { WhiteLogo } from "../../../../../assets/WhiteLogo";
import { formatNumber } from "../../../../../utils/formatNumber.util";
import { getIsProfit } from "../../../../../utils/getIsProfit.util";

import type { RecievedPnl } from "../../../../../state/mintSlice";
import type { LeveragedTokenData } from "../../../../../types/leverageTokenData";

interface ShareCardProps {
  leveragedToken: Pick<
    LeveragedTokenData,
    "symbol" | "targetAsset" | "targetLeverage" | "isLong"
  >;
  pnl: RecievedPnl;
  isPriceVisible: boolean;
}

const ShareCard = ({ leveragedToken, pnl, isPriceVisible }: ShareCardProps) => {
  const profitPercentage = pnl.profitPercent;
  const profitNominal = pnl.profitAmount;
  const profit = getIsProfit(profitNominal ?? undefined);

  return (
    <div className={styles.sharecard}>
      <img
        src={sharecardGraphicPng}
        alt="Sharecard graphic"
        className={styles.sharecardGraphic}
        decoding="sync"
        loading="eager"
      />
      <div className={styles.logo}>
        <WhiteLogo />
      </div>
      <span className={styles.direction}>
        {leveragedToken.isLong ? "Long" : "Short"}
      </span>
      <div className={styles.tokenContainer}>
        <LeveragedToken
          size={{ height: 30, width: 30 }}
          leverage={leveragedToken.targetLeverage}
          long={leveragedToken.isLong}
          token={leveragedToken.targetAsset}
        />
        <span>{leveragedToken.symbol}</span>
      </div>
      <div className={styles.redeemStats}>
        {typeof profitPercentage === "number" && (
          <span className={`${profit ? "positive" : "negative"}`}>
            {profit ? "+" : "-"}
            {formatNumber(Math.abs(profitPercentage) * 100, true)}
          </span>
        )}
        {isPriceVisible && (
          <span
            className={`${profit ? "positive" : "negative"}  ${styles.pnl}`}
          >
            ({formatNumber(profitNominal ?? undefined, false, true)})
          </span>
        )}
      </div>
    </div>
  );
};

export default ShareCard;
