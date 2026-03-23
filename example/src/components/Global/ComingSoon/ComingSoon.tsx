import React from "react";

import styles from "./ComingSoon.module.css";
import Tooltip from "../Tooltip/Tooltip";

interface ComingSoonProps {
  comingSoon?: boolean;
  children: React.ReactNode;
}

const ComingSoon = ({ children, comingSoon = true }: ComingSoonProps) => {
  return (
    <div>
      {comingSoon ? (
        <Tooltip content={"Coming Soon"}>
          <div className={styles.disabledWrapper}>
            <div
              className={styles.disabledContent}
              onClick={(e) => e.preventDefault()}
            >
              {children}
            </div>
          </div>
        </Tooltip>
      ) : (
        children
      )}
    </div>
  );
};

export default ComingSoon;
