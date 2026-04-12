import styles from "./BottomTabs.module.css";
import { useTokenTrades } from "../../hooks/useTradeFeed";
import { cn } from "../../utils/format";

import type { Token } from "../../services/types";

export default function TradesTab({ token }: { token: Token }) {
  const trades = useTokenTrades(token.address);
  const ticker = token.ticker;

  return (
    <table className={styles.tradesTable}>
      <thead className={styles.tradesHead}>
        <tr className={styles.tradesHeaderRow}>
          <th className={styles.thLeft}>Account</th>
          <th className={styles.thLeftSmall}>Type</th>
          <th className={styles.thRight}>USDC</th>
          <th className={styles.thRight}>{ticker}</th>
          <th className={styles.thRight}>Time</th>
          <th className={styles.thRightWide}>Txn</th>
        </tr>
      </thead>
      <tbody>
        {trades.map((t) => {
          const mockTxn = t.id.slice(0, 6);
          const isBuy = t.side === "BUY";
          return (
            <tr key={t.id} className={styles.tradeRow}>
              <td className={styles.tdLeft}>
                <div className={styles.walletCell}>
                  <div className={styles.walletAvatarPlaceholder} />
                  <span className={styles.walletAddress}>
                    {t.walletAddress}
                  </span>
                </div>
              </td>
              <td
                className={cn(
                  styles.tdType,
                  isBuy ? styles.tdTypeBuy : styles.tdTypeSell,
                )}
              >
                {isBuy ? "Buy" : "Sell"}
              </td>
              <td className={styles.tdUsdc}>${t.amountUsd.toLocaleString()}</td>
              <td
                className={cn(
                  styles.tdTokens,
                  isBuy ? styles.tdTokensBuy : styles.tdTokensSell,
                )}
              >
                {t.tokensAmount}
              </td>
              <td className={styles.tdTime}>{t.timestamp}</td>
              <td className={styles.tdTxn}>
                <span className={styles.txnLink}>{mockTxn}</span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
