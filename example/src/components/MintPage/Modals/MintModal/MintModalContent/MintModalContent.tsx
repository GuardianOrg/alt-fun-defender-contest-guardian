import LeveragedToken from "../../../../../assets/LeveragedToken/LeveragedToken";
import { baseAsset } from "../../../../../constants/baseAsset";
import { TARGET_ASSETS } from "../../../../../constants/targetAssets";
import { bigIntToNumber } from "../../../../../utils/bigIntToNumber.util";
import { formatBalance } from "../../../../../utils/formatBalance.util";
import { formatNumber } from "../../../../../utils/formatNumber.util";
import StandbyModeLabel from "../../../../Global/StandbyModeLabel/StandbyModeLabel";
import ApprovalStepper from "../ApprovalStepper/ApprovalStepper";
import styles from "../MintModalContainer.module.css";

import type { LeveragedTokenData } from "../../../../../types/leverageTokenData";
import type { MintModalStates } from "../../../MintForm/MintForm";

interface MintModalContentProps {
  leverageToken: LeveragedTokenData;
  leverageTokenSymbol: string;
  mintValueBigInt: bigint;
  simulatedEstimatedMint: bigint | undefined;
  minimumMint: bigint;
  setMintModalStage: (stage: MintModalStates) => void;
  setMintValue: (value: string) => void;
  setMintValueBigInt: (value: bigint | null) => void;
  mintTokens: () => Promise<void>;
}

const MintModalContent = ({
  leverageToken,
  leverageTokenSymbol,
  mintValueBigInt,
  simulatedEstimatedMint,
  minimumMint,
  setMintModalStage,
  setMintValue,
  setMintValueBigInt,
  mintTokens,
}: MintModalContentProps) => {
  return (
    <div className={styles.outer}>
      <div className={styles.titleContainer}>
        <h2>You are about to mint</h2>
      </div>
      <div className={styles.token}>
        <LeveragedToken
          size={{ height: 60, width: 60 }}
          leverage={leverageToken.targetLeverage}
          long={leverageToken.isLong}
          token={leverageToken.targetAsset}
        />
        <span>{leverageTokenSymbol}</span>
      </div>
      <div className={styles.positionValue}>
        <span>Nominal value</span>
        <span>
          {formatBalance(mintValueBigInt, 6, 6, 2)} {baseAsset.symbol}
        </span>
      </div>
      <div className={styles.informationTable}>
        <div className={styles.informationRow}>
          <span>Estimated output</span>
          <span>
            {simulatedEstimatedMint
              ? formatNumber(bigIntToNumber(simulatedEstimatedMint, 18))
              : formatNumber(
                  bigIntToNumber(mintValueBigInt, 6) /
                    bigIntToNumber(leverageToken.exchangeRate, 18),
                )}{" "}
            {leverageTokenSymbol}
          </span>
        </div>
        <div className={styles.informationRow}>
          <span>Minimum received</span>
          <span>
            {formatNumber(bigIntToNumber(minimumMint, 18))}{" "}
            {leverageTokenSymbol}
          </span>
        </div>
        <div className={styles.informationRow}>
          <span>Underlying asset</span>
          <span>
            <img
              src={
                TARGET_ASSETS.find(
                  (token) => token.symbol === leverageToken.targetAsset,
                )?.image
              }
              alt={leverageToken.targetAsset}
              width={16}
            />
            {leverageToken.targetAsset}
          </span>
        </div>
        <div className={styles.informationRow}>
          <span>Leverage</span>
          <span>
            {leverageToken.targetLeverage}x{" "}
            {leverageToken.isLong ? "Long" : "Short"}
          </span>
        </div>
        <div className={styles.informationRow}>
          <span>Fees</span>
          <span>0%</span>
        </div>
      </div>
      <div className={styles.standbyModeLabelContainer}>
        {leverageToken.isStandbyMode && <StandbyModeLabel />}
      </div>
      <ApprovalStepper
        mintAmount={mintValueBigInt}
        leverageToken={leverageToken}
        setMintModalStage={setMintModalStage}
        setMintValue={setMintValue}
        setMintValueBigInt={setMintValueBigInt}
        mintTokens={mintTokens}
      />
    </div>
  );
};

export default MintModalContent;
