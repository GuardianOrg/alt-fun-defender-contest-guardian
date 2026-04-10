import React from "react";

import styles from "./TableButtons.module.css";
import Tooltip from "../../../Global/Tooltip/Tooltip";

interface TableButtonsProps {
  isConnected: boolean;
  selectedTab: "openPositions" | "tradingHistory";
  positionsLength: number;
  setSelectedTab: (tab: "openPositions" | "tradingHistory") => void;
}

const TableButtons = ({
  isConnected,
  selectedTab,
  positionsLength,
  setSelectedTab,
}: TableButtonsProps) => {
  return (
    <div className={`${styles.tableButtons}`}>
      <div className={styles.tableDisplayButtons}>
        <button
          disabled={!isConnected}
          className={`${
            !isConnected
              ? styles.disabled
              : selectedTab === "openPositions"
                ? styles.live
                : ""
          }`}
          onClick={() => setSelectedTab("openPositions")}
        >
          Open positions{positionsLength > 0 && ` (${positionsLength})`}
        </button>

        <button
          disabled={!isConnected}
          className={`${
            !isConnected
              ? styles.disabled
              : selectedTab === "tradingHistory"
                ? styles.live
                : ""
          } 
              `}
          onClick={() => setSelectedTab("tradingHistory")}
        >
          Trade history
        </button>
      </div>
      {selectedTab === "tradingHistory" && (
        <Tooltip content={isConnected ? "Coming soon" : ""}>
          <button disabled={true} className={`${styles.disabled}`}>
            Export
          </button>
        </Tooltip>
      )}
    </div>
  );
};

export default React.memo(TableButtons);
