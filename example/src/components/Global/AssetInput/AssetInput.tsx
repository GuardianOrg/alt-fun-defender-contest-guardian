import styles from "./AssetInput.module.css";
import { inputAssets } from "../../../constants/inputAssets";
import AnimatePresenceHeight from "../AnimatePresenceHeight/AnimatePresenceHeight";

import type { InputAsset } from "../../../constants/inputAssets";

interface AssetInputProps {
  symbol?: InputAsset;
  input: {
    id: string;
    value: string;
    placeholder: string;
    error?: boolean;
    disabled?: boolean;
    onChange: (value: string) => void;
  };
  maxButton: {
    onClick: () => void;
    disabled?: boolean;
  };
  errorMessage?: string;
}

const sanitizeInput = (raw: string, maxDecimals: number) => {
  // keep only digits and dots
  let value = raw.replace(/[^0-9.]/g, "");

  // keep only the first dot
  const parts = value.split(".");
  if (parts.length > 1) {
    value = parts[0] + "." + parts.slice(1).join("").slice(0, maxDecimals);
  }

  // remove leading zeros unless "0." case
  if (/^0[0-9]/.test(value)) {
    value = String(Number(value));
  }

  return value;
};

const AssetInput = ({
  symbol,
  input,
  maxButton,
  errorMessage,
}: AssetInputProps) => {
  const inputCurrency = inputAssets.find((asset) => asset.symbol === symbol);
  const allowedDecimals = inputCurrency?.decimals ?? 18;

  return (
    <div className={styles.inputContainer}>
      <div className={styles.inputBody}>
        {inputCurrency && (
          <div className={styles.baseCurrency}>
            {inputCurrency.symbol || symbol}
            <img
              src={inputCurrency.logo}
              alt={inputCurrency.symbol + " Logo"}
            />
          </div>
        )}
        <input
          id={input.id}
          type="text"
          inputMode="decimal"
          placeholder={input.placeholder}
          value={input.value ?? ""}
          disabled={input.disabled}
          onChange={(e) => {
            const sanitized = sanitizeInput(e.target.value, allowedDecimals);
            input.onChange(sanitized);
          }}
          onPaste={(e) => {
            e.preventDefault();
            const text = e.clipboardData.getData("text");
            const sanitized = sanitizeInput(text, allowedDecimals);
            input.onChange(sanitized);
          }}
          className={input.error ? styles.error : ""}
          autoComplete="off"
          spellCheck="false"
          autoCorrect="off"
          data-testid="asset-input"
        />
        <button
          disabled={maxButton.disabled}
          onClick={maxButton.onClick}
          data-testid="max-button"
        >
          Max
        </button>
      </div>
      <AnimatePresenceHeight shouldDisplay={!!errorMessage}>
        <span className={styles.errorMessage}>{errorMessage}</span>
      </AnimatePresenceHeight>
    </div>
  );
};

export default AssetInput;
