import styles from "./TradePanel.module.css";
import {
  getSellPresetAmount,
  isSellPresetActive,
} from "./tradePanelInputPresets";
import { QUICK_AMOUNTS, SELL_PERCENT_OPTIONS } from "../../config/constants";
import { cn } from "../../utils/format";
import { srcSetFor, transformImageUrl } from "../../utils/image";
import UsdcIcon from "../icons/UsdcIcon";
import PresetChip from "../shared/PresetChip";

import type { SellQuote } from "../../services/tradeRouter";
import type { Token } from "../../services/types";

interface Props {
  mode: "buy" | "sell";
  amount: string;
  setAmount: (value: string) => void;
  isBusy: boolean;
  maxBalance: string | null;
  /** Raw wei balance so sell-percent chips round-trip through `parseUnits`. */
  maxBalanceWei: bigint | null;
  sellQuote: SellQuote | null;
  token: Token;
}

export default function TradePanelInput({
  mode,
  amount,
  setAmount,
  isBusy,
  maxBalance,
  maxBalanceWei,
  sellQuote,
  token,
}: Props) {
  const ticker = token.ticker;
  const coinIcon = (
    <div
      className={cn(
        styles.coinIcon,
        mode === "buy" ? styles.coinUsdc : styles.coinRed,
      )}
    >
      {mode === "buy" ? (
        <UsdcIcon className={styles.coinImg} />
      ) : token.image ? (
        <img
          src={transformImageUrl(token.image, { width: 32 })}
          srcSet={srcSetFor(token.image, 32) || undefined}
          alt=""
          width={32}
          height={32}
          className={styles.coinImg}
          decoding="async"
        />
      ) : (
        token.emoji
      )}
    </div>
  );

  return (
    <>
      <div className={styles.denomToggle}>
        {mode === "buy" ? "Amount in USDC" : `Amount in ${ticker}`}
      </div>

      <div className={styles.amountWrap}>
        <input
          className={styles.amountInput}
          type="number"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={isBusy}
        />
        <div className={styles.denomTag}>
          <span className={styles.denomLabel}>
            {mode === "buy" ? "USDC" : ticker}
          </span>
          {coinIcon}
        </div>
      </div>

      <div className={styles.quickRow}>
        <PresetChip onClick={() => setAmount("")} disabled={isBusy}>
          Reset
        </PresetChip>
        {mode === "buy" ? (
          QUICK_AMOUNTS.map((qa) => (
            <PresetChip
              key={qa}
              fluid
              active={amount === String(qa)}
              onClick={() => {
                setAmount(String(qa));
              }}
              disabled={isBusy}
            >
              {qa >= 1000 ? `${qa / 1000}K` : qa}
            </PresetChip>
          ))
        ) : (
          SELL_PERCENT_OPTIONS.map((pct) => {
            const computedAmount = getSellPresetAmount(
              maxBalanceWei,
              pct,
              sellQuote,
            );
            return (
              <PresetChip
                key={pct}
                fluid
                active={isSellPresetActive(amount, computedAmount)}
                onClick={() => {
                  if (computedAmount !== null && computedAmount.wei > 0n) {
                    setAmount(computedAmount.value);
                  }
                }}
                disabled={
                  isBusy || computedAmount === null || computedAmount.wei === 0n
                }
              >
                {pct}%
              </PresetChip>
            );
          })
        )}
        {mode === "buy" && (
          <PresetChip
            className={styles.maxBtn}
            onClick={() => {
              if (maxBalance) {
                const walletBal = parseFloat(maxBalance);
                setAmount(String(Math.floor(walletBal * 100) / 100));
              }
            }}
            disabled={isBusy || !maxBalance}
          >
            Max
          </PresetChip>
        )}
      </div>
    </>
  );
}
