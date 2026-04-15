import styles from "./TradePanel.module.css";
import { QUICK_AMOUNTS } from "../../config/constants";
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
        {QUICK_AMOUNTS.map((qa) => (
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
        ))}
        <button
          className={styles.maxBtn}
          onClick={() => {
            if (maxBalance) {
              if (mode === "buy") {
                const walletBal = parseFloat(maxBalance);
                setAmount(String(Math.floor(walletBal * 100) / 100));
              } else if (sellQuote && Number.isFinite(sellQuote.maxSellableTokens)) {
                const walletBal = parseFloat(maxBalance);
                const capped = Math.min(walletBal, sellQuote.maxSellableTokens);
                setAmount(String(Math.max(0, capped)));
              } else {
                setAmount(maxBalance);
              }
            }
          }}
          disabled={isBusy || !maxBalance}
        >
          Max
        </button>
      </div>
    </>
  );
}
