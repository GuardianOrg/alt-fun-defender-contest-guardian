import styles from "./RewardsCard.module.css";
import InfoTooltip from "../../../Global/Tooltip/InfoTooltip";
import Tooltip from "../../../Global/Tooltip/Tooltip";

interface RewardsCardProps {
  title: string;
  logo: string;
  value: string;
  button: { title: string; link: string };
  tooltipContent?: string;
  subTitle?: string;
  subAmount?: string;
}

const RewardsCard = ({
  title,
  logo,
  value,
  tooltipContent,
  subTitle,
  subAmount,
  button,
}: RewardsCardProps) => {
  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <h2 className={styles.title}>
          {title} {tooltipContent && <InfoTooltip content={tooltipContent} />}
        </h2>
        <p className={styles.value}>
          <img src={logo} alt="" />
          {value}
        </p>
        <Tooltip content="Coming soon">
          <button className={`${styles.button} ${styles.disabled}`}>
            {button.title}
          </button>
        </Tooltip>
      </div>
      <div className={styles.subCard}>
        {subTitle && <p className={styles.subTitle}>{subTitle}</p>}
        {subAmount && <p className={styles.subAmount}>{subAmount}</p>}
      </div>
    </div>
  );
};

export default RewardsCard;
