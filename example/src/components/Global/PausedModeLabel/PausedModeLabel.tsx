import styles from "./PausedModeLabel.module.css";
import { Info } from "../../../assets/Info";
import Tooltip from "../Tooltip/Tooltip";

const PausedModeLabel = () => {
  return (
    <div className={styles.banner} data-testid="paused-mode-label">
      <div className={styles.bannerText}>Leverage token paused</div>
      <Tooltip
        content={
          "Minting for this leveraged token is currently disabled. For updates check the Bounce Discord"
        }
      >
        <span className={styles.iconWrapper}>
          <Info
            size={14}
            backgroundColor="var(--error-400-or-white)"
            accentColor="var(--error-100-or-error-400)"
          />
        </span>
      </Tooltip>
    </div>
  );
};

export default PausedModeLabel;
