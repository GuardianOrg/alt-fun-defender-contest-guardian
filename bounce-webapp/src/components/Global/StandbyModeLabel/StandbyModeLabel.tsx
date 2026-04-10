import styles from "./StandbyModeLabel.module.css";
import { Info } from "../../../assets/Info";
import Tooltip from "../Tooltip/Tooltip";

const StandbyModeLabel = ({
  reducedSizeOnMobile,
}: {
  reducedSizeOnMobile?: boolean;
}) => {
  const isMobile = window.innerWidth <= 768;
  const bannerCopy =
    reducedSizeOnMobile && isMobile ? "Standby" : "Standby mode";

  return (
    <div className={styles.banner} data-testid="standby-label">
      <div className={styles.bannerText}>{bannerCopy}</div>
      <Tooltip
        content={
          "This token is currently in standby mode. Once >$300 has been minted it will become active."
        }
      >
        <span className={styles.iconWrapper}>
          <Info
            size={14}
            backgroundColor="var(--info-400-or-white)"
            accentColor="var(--white-or-info-400)"
          />
        </span>
      </Tooltip>
    </div>
  );
};

export default StandbyModeLabel;
