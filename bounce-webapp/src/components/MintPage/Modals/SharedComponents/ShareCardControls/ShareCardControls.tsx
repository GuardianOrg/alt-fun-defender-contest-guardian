import { useState } from "react";

import styles from "./ShareCardControls.module.css";
import { Copy } from "../../../../../assets/Copy";
import { Download } from "../../../../../assets/Download";
import { Tick } from "../../../../../assets/Tick";
import {
  isAndroidWallet,
  isIOSWallet,
} from "../../../../../utils/sharecardUtils/getWalletType";
import { handleCopyImage } from "../../../../../utils/sharecardUtils/handleCopyImage";
import { handleSaveImage } from "../../../../../utils/sharecardUtils/handleSaveImage";
import Toggle from "../../../../Global/Toggle/Toggle";
import InfoTooltip from "../../../../Global/Tooltip/InfoTooltip";

interface ShareCardToggleConfig {
  showing: boolean;
  label: string;
  ariaLabel: string;
  checked: boolean;
  onToggle: () => void;
  tooltip?: string;
}

interface ShareCardControlsProps {
  statsRef: React.RefObject<HTMLDivElement | null>;
  toggleProps?: ShareCardToggleConfig;
}

const ShareCardControls = ({
  statsRef,
  toggleProps,
}: ShareCardControlsProps) => {
  const [copied, setCopied] = useState(false);
  const hideCopyButton = isIOSWallet() || isAndroidWallet();
  const hideDownloadButton = isAndroidWallet();

  return (
    <div className={styles.sharecardControls}>
      {toggleProps?.showing ? (
        <div className={styles.toggleContainer}>
          <Toggle
            ariaLabel={toggleProps.ariaLabel}
            dataTestId="sharecard-toggle"
            checked={toggleProps.checked}
            onChange={toggleProps.onToggle}
          />

          <span>{toggleProps.label}</span>

          {toggleProps.tooltip && (
            <InfoTooltip content={toggleProps.tooltip} size={16} />
          )}
        </div>
      ) : (
        <div />
      )}

      <div className={styles.iconsContainer}>
        {!hideCopyButton && (
          <button
            onClick={() => handleCopyImage(statsRef, setCopied)}
            aria-label="Copy sharecard image"
            className={styles.controlButton}
          >
            {copied ? (
              <Tick color="var(--primary-500-or-white)" />
            ) : (
              <Copy color="var(--primary-500-or-white)" />
            )}
          </button>
        )}
        {!hideDownloadButton && (
          <button
            onClick={() => handleSaveImage(statsRef)}
            aria-label="Download sharecard image"
            className={styles.controlButton}
          >
            {Download("var(--primary-500-or-white)")}
          </button>
        )}
      </div>
    </div>
  );
};

export default ShareCardControls;
