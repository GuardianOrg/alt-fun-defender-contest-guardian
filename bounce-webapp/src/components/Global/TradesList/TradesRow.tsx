import { useDispatch } from "react-redux";

import styles from "./TradesList.module.css";
import { blockExplorerTx } from "../../../app/constants";
import { LaunchIcon } from "../../../assets/LaunchIcon";
import LeveragedToken from "../../../assets/LeveragedToken/LeveragedToken";
import { useSelectPositionAndNavigate } from "../../../pages/MintPage/useMintPageRouting";
import { openShareModal } from "../../../state/mintSlice";
import { formatBalance } from "../../../utils/formatBalance.util";
import { formatNumber } from "../../../utils/formatNumber.util";
import { getIsProfit } from "../../../utils/getIsProfit.util";
import { getLeverageTokenSymbol } from "../../../utils/getLeverageTokenSymbol.util";

import type { Trade } from "../../../hooks/Indexer/useTrades";

interface TradesListProps {
  trade: Trade;
}

const TradesRow = ({ trade }: TradesListProps) => {
  const dispatch = useDispatch();
  const selectPositionAndNavigate = useSelectPositionAndNavigate();

  const formatted = new Date(trade.timestamp * 1000).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const tradeIsInProfit =
    trade.profitAmount !== null && getIsProfit(trade.profitAmount);

  return (
    <tr key={trade.id} className={styles.tableRow}>
      <td>
        <div
          className={styles.assetCell}
          onClick={() => {
            selectPositionAndNavigate({
              targetLeverage: trade.targetLeverage,
              targetAsset: trade.targetAsset,
              isLong: trade.isLong,
            });
          }}
        >
          <LeveragedToken
            size={{ height: 30, width: 30 }}
            leverage={trade.targetLeverage}
            long={trade.isLong}
            token={trade.targetAsset}
          />
          {getLeverageTokenSymbol(
            trade.targetAsset,
            trade.targetLeverage,
            trade.isLong ? "long" : "short",
          )}
        </div>
      </td>
      <td>
        <div className={styles.timeCell}>
          {formatted}
          <a
            href={blockExplorerTx(trade.txHash)}
            target="_blank"
            rel="noopener noreferrer"
          >
            {LaunchIcon("var(--primary-500-or-white)")}
          </a>
        </div>
      </td>
      <td className={styles.activity}>{trade.isBuy ? "Buy" : "Sell"}</td>
      <td>${formatBalance(trade.baseAssetAmount, 6, 2, 2)}</td>
      {trade.profitAmount !== null && trade.profitPercent !== null ? (
        <td className={styles.pnlCell}>
          <div
            className={`${styles.pnlInner} ${tradeIsInProfit ? "positive" : "negative"}`}
          >
            {`${tradeIsInProfit ? "+" : "-"}${formatNumber(
              Math.abs(trade.profitAmount),
              false,
              true,
            )}`}{" "}
            (
            {`${tradeIsInProfit ? "+" : "-"}${formatNumber(
              Math.abs(trade.profitPercent * 100),
              true,
            )}`}
            )
            <button
              data-testid={"share-button"}
              onClick={() => {
                dispatch(
                  openShareModal({
                    positionStatus: "closed",
                    token: {
                      symbol: getLeverageTokenSymbol(
                        trade.targetAsset,
                        trade.targetLeverage,
                        trade.isLong ? "long" : "short",
                      ),
                      targetAsset: trade.targetAsset,
                      targetLeverage: trade.targetLeverage,
                      isLong: trade.isLong,
                    },
                    pnl: {
                      profitAmount: trade.profitAmount,
                      profitPercent: trade.profitPercent,
                    },
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
        <td>
          <div className={`positive ${styles.pnlCell}`}>$0.00 (0.00%)</div>
        </td>
      )}
    </tr>
  );
};

export default TradesRow;
