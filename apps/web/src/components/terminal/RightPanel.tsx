import { useNavigate } from "react-router";

import styles from "./RightPanel.module.css";
import { tokenPath } from "../../app/routes";
import { useBalances } from "../../hooks/useBalances";
import { useTokenMarketStatsMap } from "../../hooks/useTokenMarketStats";
import { useTokens } from "../../hooks/useTokens";
import { useTradeFeed } from "../../hooks/useTradeFeed";
import { useWallet } from "../../hooks/useWallet";
import {
  cn,
  formatCurveFilled,
  formatPercentOrDash,
  formatTimeAgo,
  formatUsd,
} from "../../utils/format";

export default function RightPanel() {
  const trades = useTradeFeed();
  const { data: tokens } = useTokens();
  const { getStats } = useTokenMarketStatsMap();
  const { isConnected } = useWallet();
  const { tokens: heldTokens, isLoading: balancesLoading } = useBalances();
  const navigate = useNavigate();

  const positions = [...heldTokens]
    .sort((a, b) => b.valueUsd - a.valueUsd)
    .slice(0, 5);

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
          {trades.slice(0, 7).map((t) => {
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
                    <span className={styles.tradeTime}>{formatTimeAgo(t.timestamp)}</span>
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
                {formatCurveFilled(t.curveFilled)} · {t.direction === "long" ? "LONG" : "SHORT"}
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
              {formatPercentOrDash(getStats(t.address).change24h)}{" "}
              {t.ltName.split(" ").slice(0, 2).join("")}
            </span>
          </div>
        ))}
      </div>

      {/* My positions */}
      <div>
        <div className={styles.sectionHeader}>MY POSITIONS</div>
        {!isConnected ? (
          <div className={styles.infoRow}>
            <span className={styles.infoName}>Connect wallet to view</span>
          </div>
        ) : balancesLoading && positions.length === 0 ? (
          <div className={styles.infoRow}>
            <span className={styles.infoName}>Loading…</span>
          </div>
        ) : positions.length === 0 ? (
          <div className={styles.infoRow}>
            <span className={styles.infoName}>No positions yet</span>
          </div>
        ) : (
          positions.map((p) => (
            <div
              key={p.address}
              className={cn(
                styles.infoRow,
                styles.infoRowClickable,
                styles.infoRowNoBorderLast,
              )}
              onClick={() => navigate(tokenPath(p.address))}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  navigate(tokenPath(p.address));
                }
              }}
            >
              <span className={styles.infoName}>{p.ticker || p.name}</span>
              <span className={styles.positionValue}>
                {formatUsd(p.valueUsd)}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
