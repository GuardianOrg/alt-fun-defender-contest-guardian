import { useRef, useState } from "react";

import { useSelector } from "react-redux";

import styles from "./RedeemModalSuccessContent.module.css";
import { blockExplorerTx } from "../../../../../app/constants";
import { LaunchIcon } from "../../../../../assets/LaunchIcon";
import { baseAsset } from "../../../../../constants/baseAsset";
import {
  selectLatestRedeemHash,
  selectRecievedBaseAmount,
  selectRecievedPnl,
} from "../../../../../state/mintSlice";
import formatAddress from "../../../../../utils/formatAddress.util";
import { formatBalance } from "../../../../../utils/formatBalance.util";
import Button from "../../../../Global/Buttons/Button";
import ShareCard from "../../SharedComponents/ShareCard/ShareCard";
import ShareCardControls from "../../SharedComponents/ShareCardControls/ShareCardControls";

import type { LeveragedTokenData } from "../../../../../types/leverageTokenData";

const RedeemModalSuccessContent = ({
  leverageToken,
  handleCloseSuccessModal,
}: {
  leverageToken: LeveragedTokenData;
  handleCloseSuccessModal: () => void;
}) => {
  const statsRef = useRef<HTMLDivElement>(null);
  const latestRedeemHash = useSelector(selectLatestRedeemHash);
  const recievedBaseAmount = useSelector(selectRecievedBaseAmount);
  const recievedPnl = useSelector(selectRecievedPnl);

  const [isPriceVisible, setIsPriceVisible] = useState(false);

  const text = `Trade ${leverageToken.symbol} leveraged tokens on @BounceTech!`;
  const intentUrl = `https://x.com/intent/tweet?${new URLSearchParams({
    text,
  }).toString()}`;

  const usdcClaimAmount = formatBalance(
    recievedBaseAmount,
    baseAsset.decimals,
    2,
  );

  return (
    <div>
      <div ref={statsRef}>
        <ShareCard
          leveragedToken={leverageToken}
          pnl={recievedPnl}
          isPriceVisible={isPriceVisible}
        />
      </div>
      <div className={styles.redeemedContainer}>
        <h2>Order Redeemed</h2>
        <div className={styles.informationTable}>
          <div className={styles.informationRow}>
            <span>Redeemed from</span>

            <span>{leverageToken.symbol}</span>
          </div>
          <div className={styles.informationRow}>
            <span>Amount received</span>
            <span>
              {usdcClaimAmount} {baseAsset.symbol}
            </span>
          </div>
          <div className={styles.informationRow}>
            <span>Transaction hash</span>
            <a
              href={blockExplorerTx(latestRedeemHash)}
              target="_blank"
              rel="noopener noreferrer"
            >
              {formatAddress(latestRedeemHash)}
              {LaunchIcon("var(--grey-500-or-white)")}
            </a>
          </div>
        </div>
        <div className={styles.buttonContainer}>
          <a href={intentUrl} target="_blank" rel="noopener noreferrer">
            <Button variant="primary" wide>
              Share to X
            </Button>
          </a>
          <Button variant="outlined" wide onClick={handleCloseSuccessModal}>
            Close
          </Button>
        </div>
      </div>
      <ShareCardControls
        pnl={recievedPnl}
        statsRef={statsRef}
        isPriceVisible={isPriceVisible}
        setIsPriceVisible={setIsPriceVisible}
      />
    </div>
  );
};

export default RedeemModalSuccessContent;
