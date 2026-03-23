import { useDispatch } from "react-redux";

import styles from "./PositionCard.module.css";
import { LaunchIcon } from "../../../../../assets/LaunchIcon";
import LeveragedToken from "../../../../../assets/LeveragedToken/LeveragedToken";
import { pnlDisclaimerCopy } from "../../../../../constants/pnlDisclaimerCopy";
import useLeveragedTokenPnl from "../../../../../hooks/useLeveragedTokenPnl";
import { openShareModal } from "../../../../../state/mintSlice";
import { bigIntToNumber } from "../../../../../utils/bigIntToNumber.util";
import { formatNumber } from "../../../../../utils/formatNumber.util";
import { getIsProfit } from "../../../../../utils/getIsProfit.util";
import StandbyModeLabel from "../../../../Global/StandbyModeLabel/StandbyModeLabel";
import InfoTooltip from "../../../../Global/Tooltip/InfoTooltip";
import LineChart from "../../../LineChart/LineChart";
import RedeemButton from "../../RedeemButton/RedeemButton";

import type { LeveragedTokenData } from "../../../../../types/leverageTokenData";

interface PositionCardProps {
  position: LeveragedTokenData;
  onSelect: () => void;
  onRedeem: () => void;
}

const PositionCard = ({ position, onSelect, onRedeem }: PositionCardProps) => {
  const dispatch = useDispatch();
  const positionValue = bigIntToNumber(
    position.balanceOf * position.exchangeRate,
    18 * 2,
  );

  const pnl = useLeveragedTokenPnl(position.address);
  const pnlAbsolute = pnl?.unrealized;
  const pnlPercentage = pnl?.unrealizedPercent;
  const profit = getIsProfit(pnlAbsolute);

  return (
    <div className={styles.position}>
      <div className={styles.header}>
        <div className={styles.token} onClick={onSelect}>
          <LeveragedToken
            size={{ height: 30, width: 30 }}
            leverage={position.targetLeverage}
            long={position.isLong}
            token={position.targetAsset}
          />
          {position.symbol}
        </div>
        <div className={styles.redeem}>
          <RedeemButton onClick={onRedeem} />
        </div>
      </div>
      <div className={styles.statsTable}>
        <div className={styles.statRow}>
          <span>Nominal Value</span>
          <span>${formatNumber(positionValue)}</span>
        </div>
        <div className={styles.statRow}>
          <span>ROE</span>
          {typeof pnlPercentage === "number" ? (
            <span
              className={profit ? "positive" : "negative"}
              data-testid="roe"
            >
              {`${profit ? "+" : "-"}${formatNumber(
                Math.abs(pnlPercentage * 100),
                true,
              )}`}
            </span>
          ) : (
            <span>--</span>
          )}
        </div>
        <div className={styles.statRow}>
          <span className={styles.upnlLabel}>
            uPnL <InfoTooltip content={pnlDisclaimerCopy} />
          </span>
          {typeof pnlAbsolute === "number" ? (
            <span
              className={profit ? "positive" : "negative"}
              data-testid="upnl"
            >
              {profit ? "+" : "-"}
              {formatNumber(Math.abs(pnlAbsolute), false, true)}
            </span>
          ) : (
            <span>--</span>
          )}
        </div>
      </div>
      <div className={styles.chartContainer}>
        <LineChart
          symbol={position.targetAsset}
          interval={"15m"}
          profit={profit}
        />
      </div>
      <div className={styles.bottomRow}>
        <span>{position.targetAsset} 24hr</span>
        <button
          data-testid={"share-button"}
          onClick={() => {
            dispatch(
              openShareModal({
                positionStatus: "open",
                token: position,
              }),
            );
          }}
          aria-label="Share position button"
        >
          {LaunchIcon("var(--primary-500-or-white)")}
        </button>
      </div>
      {position.isStandbyMode && <StandbyModeLabel />}
    </div>
  );
};

export default PositionCard;
