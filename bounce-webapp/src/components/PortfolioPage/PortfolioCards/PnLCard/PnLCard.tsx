import styles from "./PnLCard.module.css";
import GreenArrowUp from "../../../../assets/GreenArrowUp";
import RedArrowDown from "../../../../assets/RedArrowDown";
import { formatNumber } from "../../../../utils/formatNumber.util";
import InfoTooltip from "../../../Global/Tooltip/InfoTooltip";

interface PnLCardProps {
  title: string;
  value: number | null;
  tooltipContent?: string;
}

const PnLCard = ({ title, value, tooltipContent }: PnLCardProps) => {
  const pnlValue = value ? formatNumber(value, false, true) : "--";

  return (
    <div className={styles.card}>
      <h2 className={styles.title}>
        {title} {tooltipContent && <InfoTooltip content={tooltipContent} />}
      </h2>

      <p className={styles.value}>
        {Number(value) > 0 && <GreenArrowUp />}
        {Number(value) < 0 && <RedArrowDown />}
        {pnlValue}
      </p>
    </div>
  );
};

export default PnLCard;
