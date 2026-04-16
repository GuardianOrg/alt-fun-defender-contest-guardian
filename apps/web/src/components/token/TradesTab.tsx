import styles from "./BottomTabs.module.css";
import { useTokenTrades } from "../../hooks/useTradeFeed";
import { cn, formatTimeAgo, shortenAddress } from "../../utils/format";

import type { Token } from "../../services/types";

function extractTxHash(tradeId: string): string {
  const dashIdx = tradeId.lastIndexOf("-");
  return dashIdx > 0 ? tradeId.slice(0, dashIdx) : tradeId;
}

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
          const txHash = extractTxHash(t.id);
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
              <td className={styles.tdTime}>{formatTimeAgo(t.timestamp)}</td>
              <td className={styles.tdTxn}>
                <a
                  className={styles.txnLink}
                  href={`https://hyperevmscan.io/tx/${txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {shortenAddress(txHash)}
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={styles.externalIcon}
                  >
                    <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                </a>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
