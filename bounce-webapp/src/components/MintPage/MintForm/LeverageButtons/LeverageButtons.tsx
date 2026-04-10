import React from "react";

import { useDispatch } from "react-redux";

import styles from "./LeverageButtons.module.css";
import {
  getAvailableLeverages,
  type TargetAssetType,
} from "../../../../constants/targetAssets";
import { setLeverage } from "../../../../state/mintSlice";
import InfoTooltip from "../../../Global/Tooltip/InfoTooltip";

const LeverageButtons = ({
  selectedLeverage,
  selectedTargetAsset,
  selectedLongOrShort,
}: {
  selectedLeverage: number;
  selectedTargetAsset: TargetAssetType;
  selectedLongOrShort: "long" | "short";
}) => {
  const dispatch = useDispatch();
  const leverages = getAvailableLeverages(
    selectedTargetAsset,
    selectedLongOrShort,
  );

  return (
    <div
      className={styles.leverageButtonsContainer}
      data-testid="leverage-buttons"
    >
      <div className={styles.leverageLabel}>
        <>Leverage</>
        <InfoTooltip
          content={`The target leverage of the leveraged tokens. Actual leverage will vary within the leverage range.`}
        />
      </div>
      <div className={styles.leverageButtons}>
        {leverages.map((leverage) => (
          <button
            key={leverage}
            className={selectedLeverage === leverage ? styles.selected : ""}
            onClick={() => dispatch(setLeverage(leverage))}
          >
            {leverage}x
          </button>
        ))}
      </div>
    </div>
  );
};

export default React.memo(LeverageButtons);
