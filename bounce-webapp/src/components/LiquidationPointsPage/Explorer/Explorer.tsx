import { useState } from "react";

import { isAddress } from "viem";

import styles from "./Explorer.module.css";
import useLiquidationJourneyData from "../../../hooks/useLiquidationJourneyData";
import AnimatePresenceHeight from "../../Global/AnimatePresenceHeight/AnimatePresenceHeight";
import Button from "../../Global/Buttons/Button";
import { LiquidationsJourney } from "../LiquidationsJourney/LiquidationsJourney";

const Explorer = () => {
  const [inputAddress, setInputAddress] = useState("");
  const [showLiquidationsWrapped, setShowLiquidationsWrapped] = useState(false);
  const trimmed = inputAddress.trim();
  const isValidAddress = trimmed.length > 0 && isAddress(trimmed);
  const showInvalidWarning = trimmed.length > 0 && !isValidAddress;

  const queryAddress = isValidAddress ? trimmed : null;
  const { data: liquidationJourneyData, isLoading } =
    useLiquidationJourneyData(queryAddress);

  const hasLiquidationData =
    (liquidationJourneyData?.totalLiquidationNotional ?? 0) > 0;

  const exploreEnabled = isValidAddress && hasLiquidationData && !isLoading;

  return (
    <div className={styles.explorer}>
      {liquidationJourneyData && (
        <LiquidationsJourney
          liquidationJourneyData={liquidationJourneyData}
          show={showLiquidationsWrapped}
          hasClaimedScore={true}
          close={() => setShowLiquidationsWrapped(false)}
        />
      )}
      <h2 className={styles.title}>
        Hyperliquid Liquidations Wrapped Explorer
      </h2>

      <div className={styles.formBlock}>
        <div className={styles.inputRow}>
          <div className={styles.inputWrap}>
            <input
              type="text"
              value={inputAddress}
              onChange={(e) => setInputAddress(e.target.value)}
              placeholder="Enter wallet address"
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              className={showInvalidWarning ? styles.addressInputError : ""}
              aria-invalid={showInvalidWarning}
              aria-describedby={
                showInvalidWarning ? "explorer-address-error" : undefined
              }
            />
          </div>
          <div className={styles.exploreButtonSlot}>
            <Button
              variant="primary"
              size="small"
              onClick={() => setShowLiquidationsWrapped(true)}
              disabled={!exploreEnabled}
              loading={isValidAddress && isLoading}
            >
              Explore
            </Button>
          </div>
        </div>
        <AnimatePresenceHeight shouldDisplay={showInvalidWarning}>
          <span
            id="explorer-address-error"
            className={styles.errorMessage}
            role="alert"
          >
            Invalid address
          </span>
        </AnimatePresenceHeight>
        <AnimatePresenceHeight
          shouldDisplay={isValidAddress && !hasLiquidationData && !isLoading}
        >
          <span
            id="explorer-address-error"
            className={styles.errorMessage}
            role="alert"
          >
            No liquidation data found for this address
          </span>
        </AnimatePresenceHeight>
      </div>
    </div>
  );
};

export default Explorer;
