import styles from "./TradePanel.module.css";

import type { SellQuote } from "../../services/tradeRouter";

interface Props {
  sellQuote: SellQuote;
  ticker: string;
}

export default function TradePanelBufferWarning({ sellQuote, ticker }: Props) {
  return (
    <div className={styles.bufferWarning}>
      <span className={styles.bufferWarningTitle}>Sell amount exceeds available liquidity</span>
      <span>
        Max sellable now:{" "}
        <span className={styles.bufferWarningMax}>
          {sellQuote.maxSellableTokens.toLocaleString(undefined, {
            maximumFractionDigits: 2,
          })}
        </span>{" "}
        {ticker}
        {" "}(~${sellQuote.bufferUsdc.toLocaleString(undefined, {
          maximumFractionDigits: 2,
        })} USDC available)
      </span>
      <span className={styles.bufferWarningHint}>
        Sell in smaller amounts. Liquidity replenishes in ~10s after each sell.
      </span>
    </div>
  );
}
