import styles from "./RightPanel.module.css";
import { useTokens } from "../../hooks/useTokens";
import { useTradeFeed } from "../../hooks/useTradeFeed";
import { cn } from "../../utils/format";

export default function RightPanel() {
  const trades = useTradeFeed();
  const { data: tokens } = useTokens();

  const graduating = tokens?.filter((t) => t.status === "graduating") ?? [];
  const ltMovers =
    tokens
      ?.filter((t) => t.leverageBoost > 0)
      ?.sort((a, b) => b.leverageBoost - a.leverageBoost)
      ?.slice(0, 3) ?? [];

  return (
    <div className={styles.panel}>
      {/* Recent trades */}
      <div className={styles.section}>
        <div className={cn(styles.sectionHeader, styles.sectionHeaderLive)}>
          RECENT TRADES
          <span className={styles.liveIndicator}>
            <span className={styles.liveDot} />
            LIVE
          </span>
        </div>
        <div aria-live="polite" aria-label="Recent trades">
          {trades.map((t) => {
            const isBuy = t.side === "BUY";
            return (
              <div
                key={t.id}
                className={styles.tradeRow}
                tabIndex={0}
                aria-label={`${isBuy ? "Buy" : "Sell"} ${t.tokenName} — $${t.amountUsd.toLocaleString()} — ${t.timestamp}`}
              >
                <div className={styles.tradeInfo}>
                  <div className={styles.tradeNameRow}>
                    <span className={styles.tradeName}>{t.tokenName}</span>
                    <span className={styles.tradeTime}>{t.timestamp}</span>
                  </div>
                  <div className={styles.tradeWallet}>{t.walletAddress}</div>
                </div>
                <span
                  className={cn(
                    styles.tradeAmount,
                    isBuy ? styles.tradeAmountBuy : styles.tradeAmountSell,
                  )}
                >
                  {isBuy ? "+" : "-"}${t.amountUsd.toLocaleString()}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Graduating soon */}
      {graduating.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionHeader}>GRADUATING SOON</div>
          {graduating.map((t) => (
            <div
              key={t.address}
              className={cn(styles.infoRow, styles.infoRowNoBorderLast)}
            >
              <span className={styles.infoName}>{t.name}</span>
              <span className={styles.graduatingValue}>
                {t.curveFilled}% · {t.direction === "long" ? "LONG" : "SHORT"}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Top LT movers */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>TOP LT MOVERS</div>
        {ltMovers.map((t) => (
          <div
            key={t.address}
            className={cn(styles.infoRow, styles.infoRowNoBorderLast)}
          >
            <span className={styles.infoName}>{t.name}</span>
            <span className={styles.ltMoverValue}>
              +{t.change24h}% {t.ltName.split(" ").slice(0, 2).join("")}
            </span>
          </div>
        ))}
      </div>

      {/* My positions — placeholder until GET /portfolio/:wallet is wired */}
      <div>
        <div className={styles.sectionHeader}>MY POSITIONS</div>
        <div className={styles.infoRow}>
          <span className={styles.infoName}>Connect wallet to view</span>
        </div>
      </div>
    </div>
  );
}
