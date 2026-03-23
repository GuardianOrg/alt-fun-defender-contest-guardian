import { useState } from "react";

import styles from "./ShareCardControls.module.css";
import { Copy } from "../../../../../assets/Copy";
import { Download } from "../../../../../assets/Download";
import { Tick } from "../../../../../assets/Tick";
import { pnlDisclaimerCopy } from "../../../../../constants/pnlDisclaimerCopy";
import {
  isAndroidWallet,
  isIOSWallet,
} from "../../../../../utils/sharecardUtils/getWalletType";
import { handleCopyImage } from "../../../../../utils/sharecardUtils/handleCopyImage";
import { handleSaveImage } from "../../../../../utils/sharecardUtils/handleSaveImage";
import Toggle from "../../../../Global/Toggle/Toggle";
import InfoTooltip from "../../../../Global/Tooltip/InfoTooltip";

import type { RecievedPnl } from "../../../../../state/mintSlice";

interface ShareCardControlsProps {
  pnl: RecievedPnl;
  statsRef: React.RefObject<HTMLDivElement | null>;
  isPriceVisible: boolean;
  setIsPriceVisible: (value: boolean) => void;
}

const ShareCardControls = ({
  pnl,
  isPriceVisible,
  statsRef,
  setIsPriceVisible,
}: ShareCardControlsProps) => {
  const [copied, setCopied] = useState(false);
  const hideCopyButton = isIOSWallet() || isAndroidWallet();
  const hideDownloadButton = isAndroidWallet();

  const profitPercentage = pnl.profitPercent || 0;

  return (
    <div className={styles.sharecardControls}>
      <div className={styles.toggleContainer}>
        <Toggle
          ariaLabel="Sharecard display price toggle"
          dataTestId="sharecard-toggle"
          checked={isPriceVisible}
          onChange={() => setIsPriceVisible(!isPriceVisible)}
        />
        <span>Show {profitPercentage >= 0 ? "Profit" : "Loss"}</span>
        <InfoTooltip content={pnlDisclaimerCopy} size={16} />
      </div>
      <div className={styles.iconsContainer}>
        {!hideCopyButton && (
          <button
            onClick={() => handleCopyImage(statsRef, setCopied)}
            aria-label="Copy sharecard image"
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
          >
            {Download("var(--primary-500-or-white)")}
          </button>
        )}
      </div>
    </div>
  );
};

export default ShareCardControls;
