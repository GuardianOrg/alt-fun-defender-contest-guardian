import styles from "./TradePanel.module.css";

import type { BuyQuote, SellQuote } from "../../services/tradeRouter";

interface Props {
  mode: "buy" | "sell";
  ticker: string;
  buyQuote: BuyQuote | null;
  sellQuote: SellQuote | null;
}

export default function TradePanelQuote({ mode, ticker, buyQuote, sellQuote }: Props) {
  return (
    <div className={styles.estimate}>
      {mode === "buy" ? (
        <>
          ≈ you receive{" "}
          <span className={styles.estimateValue}>
            {buyQuote?.tokensOut ?? "…"}
          </span>{" "}
          <span className={styles.estimateMint}>{ticker}</span>
          {buyQuote && buyQuote.priceImpactPct > 1 && (
            <span className={styles.impactWarning}>
              {" "}({buyQuote.priceImpactPct.toFixed(1)}% impact)
            </span>
          )}
        </>
      ) : (
        <>
          ≈ you receive{" "}
          <span className={styles.estimateValue}>
            ${sellQuote
              ? sellQuote.youReceive.toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })
              : "…"}
          </span>{" "}
          <span className={styles.estimateLabel}>USDC</span>
          {sellQuote && sellQuote.priceImpactPct > 1 && (
            <span className={styles.impactWarning}>
              {" "}({sellQuote.priceImpactPct.toFixed(1)}% impact)
            </span>
          )}
        </>
      )}
    </div>
  );
}
