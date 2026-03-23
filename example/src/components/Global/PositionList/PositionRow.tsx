import { useEffect } from "react";

import { useDispatch } from "react-redux";

import styles from "./PositionList.module.css";
import { LaunchIcon } from "../../../assets/LaunchIcon";
import LeveragedToken from "../../../assets/LeveragedToken/LeveragedToken";
import useLeveragedTokenPnl from "../../../hooks/useLeveragedTokenPnl";
import { useSelectPositionAndNavigate } from "../../../pages/MintPage/useMintPageRouting";
import { setOpenRedeemModal, openShareModal } from "../../../state/mintSlice";
import { bigIntToNumber } from "../../../utils/bigIntToNumber.util";
import { formatNumber } from "../../../utils/formatNumber.util";
import { getIsProfit } from "../../../utils/getIsProfit.util";
import RedeemButton from "../../MintPage/Positions/RedeemButton/RedeemButton";
import StandbyModeLabel from "../StandbyModeLabel/StandbyModeLabel";

import type { LeveragedTokenData } from "../../../types/leverageTokenData";

interface PositionListProps {
  position: LeveragedTokenData;
  onUnrealizedPnl: (symbol: string, pnl?: number) => void;
}

const PositionRow = ({ position, onUnrealizedPnl }: PositionListProps) => {
  const dispatch = useDispatch();
  const selectPositionAndNavigate = useSelectPositionAndNavigate();

  const pnl = useLeveragedTokenPnl(position.address);

  useEffect(() => {
    if (!position?.symbol) return;
    onUnrealizedPnl(position?.symbol, pnl?.unrealized);
  }, [pnl?.unrealized, position?.symbol, onUnrealizedPnl]);

  const positionValue = bigIntToNumber(
    position.balanceOf * position.exchangeRate,
    18 * 2,
  );

  const pnlAbsolute = pnl?.unrealized;
  const pnlPercentage = pnl?.unrealizedPercent;
  const profit = getIsProfit(pnlAbsolute);

  return (
    <tr key={position.symbol} className={styles.tableRow}>
      <td>
        <div className={styles.tokenCell}>
          <div
            className={styles.token}
            onClick={() => {
              selectPositionAndNavigate(position);
            }}
          >
            <LeveragedToken
              size={{ height: 30, width: 30 }}
              leverage={position.targetLeverage}
              long={position.isLong}
              token={position.targetAsset}
            />
            <span className={styles.tokenText}>{position.symbol}</span>
          </div>
          {position.isStandbyMode && <StandbyModeLabel reducedSizeOnMobile />}
        </div>
      </td>
      <td>
        <div className={styles.positionValue}>
          ${formatNumber(positionValue)}
        </div>
      </td>
      {pnlAbsolute !== undefined && pnlPercentage !== undefined ? (
        <td>
          <div
            className={`${profit ? "positive" : "negative"} ${styles.pnlCell}`}
          >
            {`${profit ? "+" : "-"}${formatNumber(
              Math.abs(pnlAbsolute),
              false,
              true,
            )}`}{" "}
            (
            {`${profit ? "+" : "-"}${formatNumber(
              Math.abs(pnlPercentage * 100),
              true,
            )}`}
            )
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
        </td>
      ) : (
        <td> -- </td>
      )}
      <td className={styles.redeem}>
        <RedeemButton
          onClick={() => {
            dispatch(setOpenRedeemModal(position));
          }}
        />
      </td>
    </tr>
  );
};

export default PositionRow;
