import React from "react";

import styles from "./MintFormTitle.module.css";

const MintFormTitle = () => {
  return (
    <>
      <div className={styles.desktopTitleContainer}>
        <h1 className={styles.title}>
          Mint <span className={styles.titleHighlight}>Leveraged Tokens</span>
        </h1>
      </div>
      <span className={styles.mobileTitle}>Mint Leveraged Tokens</span>
    </>
  );
};

export default React.memo(MintFormTitle);
