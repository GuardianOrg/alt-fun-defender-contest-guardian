import { useEffect } from "react";

import styles from "./MintModalContainer.module.css";
import MintModalContent from "./MintModalContent/MintModalContent";
import MintModalSuccessContent from "./MintModalSuccessContent/MintModalSuccessContent";
import { trackEvent } from "../../../../analytics/ga";
import useMintTokens from "../../../../web3/writes/useMintTokens";
import Popup from "../../../Global/Popup/Popup";

import type { LeveragedTokenData } from "../../../../types/leverageTokenData";
import type { MintModalStates } from "../../MintForm/MintForm";

interface MintModalProps {
  leverageToken: LeveragedTokenData;
  leverageTokenSymbol: string;
  mintValueBigInt: bigint;
  stage: MintModalStates;
  selectedLeverage: number;
  setMintModalStage: (stage: MintModalStates) => void;
  setMintValue: (value: string) => void;
  setMintValueBigInt: (value: bigint | null) => void;
}

const MintModalContainer = ({
  leverageToken,
  leverageTokenSymbol,
  mintValueBigInt,
  stage,
  selectedLeverage,
  setMintModalStage,
  setMintValue,
  setMintValueBigInt,
}: MintModalProps) => {
  const { hash, simulatedEstimatedMint, minimumMint, mintTokens, refetch } =
    useMintTokens(
      mintValueBigInt,
      leverageToken.address,
      selectedLeverage,
      leverageToken.exchangeRate,
    );

  useEffect(() => {
    if (leverageToken.exchangeRate) {
      refetch();
    }
  }, [leverageToken.exchangeRate, refetch]);

  return (
    <>
      <Popup
        show={stage === "confirm"}
        close={() => {
          setMintModalStage("closed");
          trackEvent("mint_action", {
            label: "mint_modal_closed",
          });
        }}
        maxWidth={"36rem"}
      >
        <div className={styles.container}>
          <MintModalContent
            leverageToken={leverageToken}
            leverageTokenSymbol={leverageTokenSymbol}
            mintValueBigInt={mintValueBigInt}
            simulatedEstimatedMint={simulatedEstimatedMint}
            minimumMint={minimumMint}
            setMintModalStage={setMintModalStage}
            setMintValue={setMintValue}
            setMintValueBigInt={setMintValueBigInt}
            mintTokens={mintTokens}
          />
        </div>
      </Popup>

      <Popup
        show={stage === "success"}
        close={() => {
          setMintModalStage("closed");
          trackEvent("mint_action", {
            label: "mint_success_modal_closed",
          });
        }}
        maxWidth={"36rem"}
      >
        <div className={styles.container}>
          <MintModalSuccessContent
            leverageToken={leverageToken}
            leverageTokenSymbol={leverageTokenSymbol}
            hash={hash}
            setMintModalStage={setMintModalStage}
          />
        </div>
      </Popup>
    </>
  );
};

export default MintModalContainer;
