import React from "react";

import styles from "./Warning.module.css";

const Warning = ({
  message,
  ctaText,
  onClick,
}: {
  message: string;
  ctaText?: string;
  onClick?: () => void;
}) => {
  return (
    <div className={styles.warning}>
      <p>{message}</p>
      {ctaText && <span onClick={onClick}>{ctaText}</span>}
    </div>
  );
};

export default React.memo(Warning);
