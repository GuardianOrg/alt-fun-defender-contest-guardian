import { useDispatch, useSelector } from "react-redux";

import styles from "./RedeemModalContainer.module.css";
import RedeemModalContent from "./RedeemModalContent/RedeemModalContent";
import RedeemModalSuccessContent from "./RedeemModalSuccessContent/RedeemModalSuccessContent";
import { trackEvent } from "../../../../analytics/ga";
import useLeveragedTokenPnl from "../../../../hooks/useLeveragedTokenPnl";
import {
  selectLeveragedTokenForRedeem,
  selectRedeemModalStage,
  selectTransactionProcessing,
  setRedeemModalStage,
} from "../../../../state/mintSlice";
import { setToast } from "../../../../state/toastSlice";
import Popup from "../../../Global/Popup/Popup";

const RedeemModalContainer = () => {
  const dispatch = useDispatch();

  // convert to useLeveragedToken once baseAssetBalance etc is live.
  const leverageToken = useSelector(selectLeveragedTokenForRedeem);
  const redeemModalStage = useSelector(selectRedeemModalStage);
  const redeemProcessing = useSelector(selectTransactionProcessing);
  const pnl = useLeveragedTokenPnl(leverageToken?.address);
  const handleCloseSuccessModal = () => {
    dispatch(setRedeemModalStage("closed"));
    trackEvent("redeem_action", {
      label: "redeem_success_modal_closed",
    });
  };

  return (
    <>
      <Popup
        show={redeemModalStage === "redeem"}
        close={() => {
          dispatch(setRedeemModalStage("closed"));
          trackEvent("redeem_action", {
            label: "redeem_modal_closed",
          });
          if (redeemProcessing) {
            dispatch(
              setToast({
                isOpen: true,
                variant: "info",
                content: "Redeem is processing in the background.",
                loadingIcon: true,
                id: crypto.randomUUID(),
              }),
            );
          }
        }}
        header="Redeem"
        maxWidth={"36rem"}
      >
        {leverageToken && (
          <div className={styles.container}>
            <RedeemModalContent leverageToken={leverageToken} pnl={pnl} />
          </div>
        )}
      </Popup>
      <Popup
        show={redeemModalStage === "success"}
        close={handleCloseSuccessModal}
        noPadding
        maxWidth={"36rem"}
      >
        {leverageToken && (
          <div className={styles.container}>
            <RedeemModalSuccessContent
              leverageToken={leverageToken}
              handleCloseSuccessModal={handleCloseSuccessModal}
            />
          </div>
        )}
      </Popup>
    </>
  );
};

export default RedeemModalContainer;
