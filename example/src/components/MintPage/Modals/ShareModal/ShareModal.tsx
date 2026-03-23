import { useRef, useState } from "react";

import { useDispatch, useSelector } from "react-redux";

import styles from "./ShareModal.module.css";
import useLeveragedTokenPnl from "../../../../hooks/useLeveragedTokenPnl";
import {
  closeShareModal,
  selectShareModalIsOpen,
  selectShareModalPayload,
} from "../../../../state/mintSlice";
import Button from "../../../Global/Buttons/Button";
import Popup from "../../../Global/Popup/Popup";
import ShareCard from "../SharedComponents/ShareCard/ShareCard";
import ShareCardControls from "../SharedComponents/ShareCardControls/ShareCardControls";

const ShareModal = () => {
  const dispatch = useDispatch();
  const statsRef = useRef<HTMLDivElement>(null);

  const payload = useSelector(selectShareModalPayload);
  const isOpen = useSelector(selectShareModalIsOpen);

  const [isPriceVisible, setIsPriceVisible] = useState(false);

  const livePnl = useLeveragedTokenPnl(
    payload?.positionStatus === "open" ? payload.token.address : undefined,
  );

  if (!payload) return null;

  const leveragedToken = payload.token;

  const pnl =
    payload.positionStatus === "closed"
      ? payload.pnl
      : {
          profitAmount: livePnl?.unrealized ?? null,
          profitPercent: livePnl?.unrealizedPercent ?? null,
        };

  const text = `Trade ${leveragedToken.symbol} leveraged tokens on @BounceTech!`;
  const intentUrl = `https://x.com/intent/tweet?${new URLSearchParams({
    text,
  }).toString()}`;

  return (
    <Popup
      show={isOpen}
      close={() => dispatch(closeShareModal())}
      noPadding
      noGap
      maxWidth={"36rem"}
    >
      <div ref={statsRef}>
        <ShareCard
          leveragedToken={leveragedToken}
          pnl={pnl}
          isPriceVisible={isPriceVisible}
        />
      </div>

      <div className={styles.buttonContainer}>
        <a href={intentUrl} target="_blank" rel="noopener noreferrer">
          <Button variant="primary" wide>
            Share to X
          </Button>
        </a>
      </div>

      <ShareCardControls
        pnl={pnl}
        statsRef={statsRef}
        isPriceVisible={isPriceVisible}
        setIsPriceVisible={setIsPriceVisible}
      />
    </Popup>
  );
};

export default ShareModal;
