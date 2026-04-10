import { useDispatch, useSelector } from "react-redux";
import { useSwitchChain } from "wagmi";

import styles from "./LifiModal.module.css";
import { LifiModalListener } from "./LifiModalListener";
import { LifiWidget } from "./LifiWidget";
import { trackEvent } from "../../../analytics/ga";
import { hyperEvm } from "../../../constants/hyperEvm";
import {
  selectDepositIsOpen,
  setDepositIsOpen,
} from "../../../state/depositSlice";
import Popup from "../Popup/Popup";

export const LifiModal = () => {
  const dispatch = useDispatch();
  const { switchChain } = useSwitchChain();

  const isDepositOpen = useSelector(selectDepositIsOpen);

  const handleClose = async () => {
    dispatch(setDepositIsOpen(false));
    trackEvent("deposit_action", {
      label: "deposit_modal_closed",
    });

    try {
      await switchChain({ chainId: hyperEvm.id });
    } catch (err) {
      console.warn("Failed to switch back to HyperEVM", err);
    }
  };

  return (
    <Popup show={isDepositOpen} close={handleClose} noPadding maxWidth="40rem">
      <LifiModalListener onRouteCompleted={handleClose} />
      <div className={styles.scrollArea}>
        <LifiWidget />
      </div>
    </Popup>
  );
};
