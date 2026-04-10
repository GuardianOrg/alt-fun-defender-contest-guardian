import styles from "./TransactionInformationTable.module.css";
import { useGlobalStorageData } from "../../../../../../hooks/Indexer/useGlobalStorage";
import { bigIntToNumber } from "../../../../../../utils/bigIntToNumber.util";
import { formatNumber } from "../../../../../../utils/formatNumber.util";
import InfoTooltip from "../../../../../Global/Tooltip/InfoTooltip";
import Tooltip from "../../../../../Global/Tooltip/Tooltip";

interface TransactionInformationTableProps {
  usdcRedeemEquivalent: string;
  usdcMinimumRedeemEquivalent?: string;
  redeemPendingFlowRequired: boolean;
  redeemPnl: number;
  feeAmount: number;
}

const TransactionInformationTable = ({
  usdcRedeemEquivalent,
  usdcMinimumRedeemEquivalent,
  redeemPendingFlowRequired,
  redeemPnl,
  feeAmount,
}: TransactionInformationTableProps) => {
  const globalStorageData = useGlobalStorageData();
  const profit = Math.round(redeemPnl * 100) / 100;
  const redemptionFee = `$${formatNumber(feeAmount, false, false, false)}`;
  const uPnlIncludingRedemptionFee = `${redeemPnl <= feeAmount ? "-$" : "$"}${formatNumber(Math.abs(redeemPnl - feeAmount), false, false, false)}`;
  const feePercentage = `${bigIntToNumber(globalStorageData.redemptionFee, 18) * 100}%`;

  const uPnlValueTooltip = `${uPnlIncludingRedemptionFee} including redemption fee`;
  const redemptionFeeTooltip =
    "The redemption fee is only accounted for in realized PnL";

  return (
    <div className={styles.informationTable}>
      <div className={styles.informationRow}>
        <span>Estimated output</span>
        <span>{usdcRedeemEquivalent} USDC</span>
      </div>
      {usdcMinimumRedeemEquivalent && (
        <div className={styles.informationRow}>
          <span>Minimum received</span>
          <span>{usdcMinimumRedeemEquivalent} USDC</span>
        </div>
      )}
      <div className={styles.informationRow}>
        <span>uPnL</span>
        <Tooltip content={uPnlValueTooltip}>
          <span
            className={`${profit > 0 ? "positive" : profit < 0 ? "negative" : ""} ${styles.hoverable}`}
          >
            {profit < 0 ? "-$" : "$"}
            <span
              className={`${profit > 0 ? "positive" : profit < 0 ? "negative" : ""} ${styles.underlined}`}
            >
              {formatNumber(Math.abs(redeemPnl), false)}
            </span>
          </span>
        </Tooltip>
      </div>
      <div className={styles.informationRow}>
        <span>
          Redemption fee <InfoTooltip content={redemptionFeeTooltip} />
        </span>
        <Tooltip content={redemptionFee}>
          <span className={`${styles.hoverable} ${styles.underlined}`}>
            {feePercentage}
          </span>
        </Tooltip>
      </div>
      <div className={styles.informationRow}>
        <span>Estimated transaction time</span>
        <span>{redeemPendingFlowRequired ? "~15s" : "~1s"}</span>
      </div>
    </div>
  );
};

export default TransactionInformationTable;
