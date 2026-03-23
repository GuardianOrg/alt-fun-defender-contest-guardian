import { useState } from "react";

import { useSelector } from "react-redux";

import styles from "./RedeemInput.module.css";
import { selectRedeemButtonState } from "../../../../../../state/mintSlice";
import { bigIntToString } from "../../../../../../utils/bigIntToString.util";
import { formatNumber } from "../../../../../../utils/formatNumber.util";
import { stringToBigInt } from "../../../../../../utils/stringToBigInt.util";
import AssetInput from "../../../../../Global/AssetInput/AssetInput";
import InfoTooltip from "../../../../../Global/Tooltip/InfoTooltip";

import type { LeveragedTokenData } from "../../../../../../types/leverageTokenData";

interface RedeemInputProps {
  leverageToken: LeveragedTokenData;
  minLeveragedTokenAmountBuffer: number;
  inputError: boolean;
  errorMessage?: string;
  setRedeemValueBigInt: (value: bigint) => void;
}

const RedeemInput = ({
  leverageToken,
  minLeveragedTokenAmountBuffer,
  inputError,
  errorMessage,
  setRedeemValueBigInt,
}: RedeemInputProps) => {
  const [redeemValue, setRedeemValue] = useState<string>("");
  const redeemButton = useSelector(selectRedeemButtonState);
  const inputDisabled = redeemButton === "loading";

  return (
    <div>
      <div className={styles.inputHeader}>
        <p>Redeem Amount</p>
        <InfoTooltip
          content={`The amount of ${
            leverageToken.symbol
          } to redeem. The minimum redeem amount is ${formatNumber(
            minLeveragedTokenAmountBuffer,
          )} ${leverageToken.symbol}.`}
        />
      </div>
      <AssetInput
        input={{
          id: "mintValue",
          value: redeemValue,
          placeholder: "Size",
          error: inputError,
          disabled: inputDisabled,
          onChange: (value) => {
            setRedeemValue(value === "" ? "" : value);
            setRedeemValueBigInt(
              value === "" ? BigInt(0) : stringToBigInt(value, 18),
            );
          },
        }}
        maxButton={{
          disabled: inputDisabled,
          onClick: () => {
            setRedeemValue(bigIntToString(leverageToken.balanceOf, 18));
            setRedeemValueBigInt(BigInt(leverageToken.balanceOf));
          },
        }}
        errorMessage={errorMessage}
      />
    </div>
  );
};

export default RedeemInput;
