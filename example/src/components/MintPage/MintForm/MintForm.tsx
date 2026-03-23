import { useState } from "react";

import { useDispatch, useSelector } from "react-redux";

import InputContainer from "./InputContainer/InputContainer";
import LeverageButtons from "./LeverageButtons/LeverageButtons";
import LongShortToggle from "./LongShortToggle/LongShortToggle";
import MintButton from "./MintButton/MintButton";
import styles from "./MintForm.module.css";
import MintFormTitle from "./MintFormTitle/MintFormTitle";
import TokenInformationDropdown from "./TokenInformationDropdown/TokenInformationDropdown";
import { trackEvent } from "../../../analytics/ga";
import { useGlobalStorageData } from "../../../hooks/Indexer/useGlobalStorage";
import { useIsUserBlocked } from "../../../hooks/useIsUserBlocked";
import { setDepositIsOpen } from "../../../state/depositSlice";
import {
  selectLeverage,
  selectSelectedTargetAsset,
  selectPendingTransactionWarning,
  selectLongOrShort,
  setPendingTransactionWarning,
  selectLeverageTokenSymbol,
} from "../../../state/mintSlice";
import { formatBalance } from "../../../utils/formatBalance.util";
import { useBaseAssetBalance } from "../../../web3/views/useBaseAssetBalance";
import useBounceAccount from "../../../web3/views/useBounceAccount";
import useLeveragedTokens from "../../../web3/views/useLeveragedTokens";
import AnimatePresenceHeight from "../../Global/AnimatePresenceHeight/AnimatePresenceHeight";
import Button from "../../Global/Buttons/Button";
import PausedModeLabel from "../../Global/PausedModeLabel/PausedModeLabel";
import Warning from "../../Global/Warning/Warning";
import MintModal from "../Modals/MintModal/MintModalContainer";

export type MintModalStates = "closed" | "confirm" | "success";

const MintForm = () => {
  const dispatch = useDispatch();
  const { isUserBlocked } = useIsUserBlocked();
  const { isConnected } = useBounceAccount();
  const leveragedTokens = useLeveragedTokens();
  const baseBalanceBigInt = useBaseAssetBalance() || BigInt(0);
  const globalStorageData = useGlobalStorageData();

  const selectedTargetAsset = useSelector(selectSelectedTargetAsset);
  const selectedLeverage = useSelector(selectLeverage);
  const selectedLongShort = useSelector(selectLongOrShort);
  const pendingTransactionWarning = useSelector(
    selectPendingTransactionWarning,
  );
  const leverageTokenSymbol = useSelector(selectLeverageTokenSymbol);

  const [mintValueBigInt, setMintValueBigInt] = useState<bigint | null>(null);
  const [mintValue, setMintValue] = useState<string>("");
  const [mintModalStage, setMintModalStage] =
    useState<MintModalStates>("closed");

  const mintValueNumber =
    mintValue && !isNaN(Number(mintValue)) ? Number(mintValue) : null;

  const currentLeveragedToken = leveragedTokens?.find(
    (token) => token.symbol === leverageTokenSymbol,
  );

  const minTransactionSizeBigInt = 15000000n;

  const formattedMinTransactionSize = formatBalance(
    minTransactionSizeBigInt,
    6,
    6,
  );

  const isLTPaused =
    currentLeveragedToken?.mintPaused || globalStorageData?.allMintsPaused;

  const hasMintValue = mintValueBigInt !== null;
  const isBlockedWithInput = isUserBlocked && hasMintValue;
  const isConnectedWithInput = isConnected && hasMintValue;
  const isBelowMin =
    isConnectedWithInput && minTransactionSizeBigInt > mintValueBigInt;
  const hasInsufficientBalance =
    isConnectedWithInput && baseBalanceBigInt < mintValueBigInt;
  const inputError = isBlockedWithInput || isBelowMin || hasInsufficientBalance;

  let errorMessage: string | undefined;

  if (isBlockedWithInput) {
    errorMessage = "Minting is not available in your region.";
  } else if (isBelowMin) {
    errorMessage = `Insufficient mint amount. Minimum transaction is ${formattedMinTransactionSize} USD`;
  } else if (hasInsufficientBalance) {
    errorMessage = "Insufficient balance.";
  }

  const renderCTA = () => {
    if (!isConnected) {
      return (
        <Button variant="primary" addressRequired>
          Mint
        </Button>
      );
    }

    if (baseBalanceBigInt < minTransactionSizeBigInt) {
      return (
        <Button
          variant="secondary"
          onClick={() => {
            dispatch(setDepositIsOpen(true));
            trackEvent("deposit_action", {
              label: "deposit_modal_opened",
              location: "mint_form",
            });
          }}
        >
          Bridge
        </Button>
      );
    }

    return (
      <MintButton
        mintValueNumber={mintValueNumber}
        isConnected={isConnected}
        inputError={inputError || isLTPaused}
        leveragedTokenSelected={!!currentLeveragedToken}
        pendingTransactionWarning={pendingTransactionWarning}
        leverageTokenSymbol={leverageTokenSymbol}
        setMintModalStage={setMintModalStage}
      />
    );
  };

  return (
    <div className={styles.mintForm}>
      <MintFormTitle />
      <LongShortToggle selectedLongShort={selectedLongShort} />
      <LeverageButtons
        selectedLeverage={selectedLeverage}
        selectedTargetAsset={selectedTargetAsset}
      />
      <InputContainer
        inputError={inputError}
        errorMessage={errorMessage}
        minTransactionSize={formattedMinTransactionSize}
        baseBalanceBigInt={baseBalanceBigInt}
        isConnected={isConnected}
        mintValue={mintValue}
        setMintValue={setMintValue}
        setMintValueBigInt={setMintValueBigInt}
      />
      {isLTPaused && <PausedModeLabel />}
      {renderCTA()}
      <AnimatePresenceHeight
        shouldDisplay={pendingTransactionWarning && mintModalStage === "closed"}
        className={styles.tokenValue}
      >
        <Warning
          message={
            "You didn't complete your last transaction. Check your wallet for unfinished transactions."
          }
          ctaText={"Ignore"}
          onClick={() => {
            dispatch(setPendingTransactionWarning(false));
          }}
        />
      </AnimatePresenceHeight>
      <TokenInformationDropdown
        leverageTokenSymbol={leverageTokenSymbol}
        leverageToken={currentLeveragedToken}
      />
      {currentLeveragedToken && (
        <MintModal
          leverageToken={currentLeveragedToken}
          leverageTokenSymbol={leverageTokenSymbol}
          mintValueBigInt={mintValueBigInt || BigInt(0)}
          stage={mintModalStage}
          selectedLeverage={selectedLeverage}
          setMintModalStage={setMintModalStage}
          setMintValue={setMintValue}
          setMintValueBigInt={setMintValueBigInt}
        />
      )}
    </div>
  );
};

export default MintForm;
