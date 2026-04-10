import React from "react";

import styles from "./RedeemButton.module.css";

interface RedeemButtonProps {
  onClick: () => void;
}

const RedeemButton = ({ onClick }: RedeemButtonProps) => {
  return (
    <button className={styles.button} onClick={onClick}>
      Redeem
    </button>
  );
};

export default React.memo(RedeemButton);
