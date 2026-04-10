import React from "react";

import styles from "./CorePageTitle.module.css";
import bounceToken from "../../../assets/bounce-token.svg";

interface CorePageTitleProps {
  title: string;
  titleHighlight?: string;
}

const CorePageTitle: React.FC<CorePageTitleProps> = ({
  title,
  titleHighlight,
}) => {
  return (
    <div className={styles.titleContainer}>
      <img src={bounceToken} alt="Liquidation score icon" />
      <h1 className={styles.title}>
        {title}{" "}
        {titleHighlight && (
          <span className={styles.titleHighlight}>{titleHighlight}</span>
        )}
      </h1>
    </div>
  );
};

export default React.memo(CorePageTitle);
