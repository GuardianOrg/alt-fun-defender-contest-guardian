import styles from "./TradePanel.module.css";
import { QUICK_AMOUNTS, SELL_PERCENT_OPTIONS } from "../../config/constants";
import { cn } from "../../utils/format";

import type { SellQuote } from "../../services/tradeRouter";
import type { Token } from "../../services/types";

interface Props {
  mode: "buy" | "sell";
  amount: string;
  setAmount: (value: string) => void;
  isBusy: boolean;
  maxBalance: string | null;
  sellQuote: SellQuote | null;
  token: Token;
}

export default function TradePanelInput({
  mode,
  amount,
  setAmount,
  isBusy,
  maxBalance,
  sellQuote,
  token,
}: Props) {
  const ticker = token.ticker;

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
          <div
            className={cn(
              styles.coinIcon,
              mode === "buy" ? styles.coinUsdc : styles.coinRed,
            )}
          >
            {mode === "buy" ? (
              "$"
            ) : token.image ? (
              <img src={token.image} alt="" className={styles.coinImg} />
            ) : (
              token.emoji
            )}
          </div>
        </div>
      </div>

      <div className={styles.quickRow}>
        <button
          className={styles.resetBtn}
          onClick={() => setAmount("")}
          disabled={isBusy}
        >
          Reset
        </button>
        {mode === "buy" ? (
          QUICK_AMOUNTS.map((qa) => (
            <button
              key={qa}
              className={cn(
                styles.quickBtn,
                amount === String(qa) && styles.quickBtnActive,
              )}
              onClick={() => {
                setAmount(String(qa));
              }}
              disabled={isBusy}
            >
              {qa >= 1000 ? `${qa / 1000}K` : qa}
            </button>
          ))
        ) : (
          SELL_PERCENT_OPTIONS.map((pct) => {
            const computedValue = maxBalance
              ? (() => {
                  const bal = parseFloat(maxBalance);
                  const cap =
                    sellQuote && Number.isFinite(sellQuote.maxSellableTokens)
                      ? Math.min(bal, sellQuote.maxSellableTokens)
                      : bal;
                  return String(Math.max(0, cap * (pct / 100)));
                })()
              : null;
            return (
              <button
                key={pct}
                className={cn(
                  styles.quickBtn,
                  computedValue !== null &&
                    amount === computedValue &&
                    styles.quickBtnActive,
                )}
                onClick={() => {
                  if (computedValue !== null) {
                    setAmount(computedValue);
                  }
                }}
                disabled={isBusy || !maxBalance}
              >
                {pct}%
              </button>
            );
          })
        )}
        {mode === "buy" && (
          <button
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
          </button>
        )}
      </div>
    </>
  );
}
