import React from "react";

import styles from "./InputContainer.module.css";
import { baseAsset } from "../../../../constants/baseAsset";
import { bigIntToString } from "../../../../utils/bigIntToString.util";
import { formatBalance } from "../../../../utils/formatBalance.util";
import { stringToBigInt } from "../../../../utils/stringToBigInt.util";
import AssetInput from "../../../Global/AssetInput/AssetInput";
import InfoTooltip from "../../../Global/Tooltip/InfoTooltip";

interface InputContainerProps {
  inputError: boolean;
  errorMessage?: string;
  minTransactionSize: string;
  baseBalanceBigInt: bigint;
  isConnected: boolean;
  mintValue: string;
  setMintValue: (value: string) => void;
  setMintValueBigInt: (value: bigint | null) => void;
}

const InputContainer = ({
  inputError,
  errorMessage,
  minTransactionSize,
  baseBalanceBigInt,
  isConnected,
  mintValue,
  setMintValue,
  setMintValueBigInt,
}: InputContainerProps) => {
  const baseBalance = formatBalance(baseBalanceBigInt, 6, 2, 2);

  return (
    <div className={styles.inputContainer} data-testid="input-container">
      <div className={styles.inputHeader}>
        <div className={styles.mintAmountLabel}>
          Mint Amount
          <InfoTooltip
            content={`The amount of ${baseAsset.symbol} to use to mint the leveraged tokens. Leveraged tokens can be redeemed for ${baseAsset.symbol} at any time. Minimum mint amount is ${minTransactionSize} ${baseAsset.symbol} per transaction.`}
          />
        </div>
        <span
          className={`${styles.userBalance} ${inputError ? styles.error : ""}`}
        >
          Your balance: {baseBalance && isConnected ? baseBalance : "--"}
        </span>
      </div>
      <AssetInput
        symbol={baseAsset.symbol}
        input={{
          id: "mintValue",
          value: mintValue ?? "",
          onChange: (value) => {
            setMintValue(value === "" ? "" : value);
            setMintValueBigInt(value === "" ? null : stringToBigInt(value, 6));
          },
          placeholder: "Size",
          error: !!inputError,
        }}
        maxButton={{
          onClick: () => {
            setMintValue(bigIntToString(baseBalanceBigInt, 6));
            setMintValueBigInt(BigInt(baseBalanceBigInt));
          },
          disabled: !isConnected || !baseBalance,
        }}
        errorMessage={errorMessage}
      />
    </div>
  );
};

export default React.memo(InputContainer);
