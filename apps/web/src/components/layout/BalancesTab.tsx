import styles from "./EarningsPanel.module.css";
import { cn, formatUsd, formatPercent, formatTokenAmount } from "../../utils/format";
import Button from "../shared/Button";

import type { HeldToken } from "../../services/types";

interface Props {
  tokens: HeldToken[];
  totalValue: number;
  onTokenClick: (addr: string) => void;
  onLaunch: () => void;
}

export default function BalancesTab({
  tokens,
  totalValue,
  onTokenClick,
  onLaunch,
}: Props) {
  if (tokens.length === 0) {
    return (
      <div className={styles.emptyState}>
        <div className={styles.emptyIcon}>&#x1F4ED;</div>
        <div className={styles.textCenter}>
          <div className={styles.emptyTitle}>No tokens yet</div>
          <div className={styles.emptyText}>
            Buy tokens on the bonding curve or launch your own levered token.
          </div>
        </div>
        <Button variant="primary" onClick={onLaunch}>
          &#x26A1; Launch a token
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className={styles.totalValueWrap}>
        <div className={styles.totalValueLabel}>total value</div>
        <div className={styles.totalValueAmount}>{formatUsd(totalValue)}</div>
      </div>

      <div className={styles.listHeader}>
        <span className={styles.listHeaderLeft}>Coins</span>
        <span className={styles.listHeaderRight}>Value</span>
      </div>

      <div className={styles.tokenList}>
        {tokens.map((t) => (
          <div
            key={t.address}
            className={styles.tokenRow}
            onClick={() => onTokenClick(t.address)}
          >
            <span className={styles.tokenEmoji}>{t.emoji}</span>
            <div className={styles.tokenInfo}>
              <div className={styles.tokenName}>{t.name}</div>
              <div className={styles.tokenAmount}>
                {formatTokenAmount(t.amount)} {t.ticker}
              </div>
            </div>
            <div className={styles.tokenValueWrap}>
              <div className={styles.tokenValue}>{formatUsd(t.valueUsd)}</div>
              <div
                className={cn(
                  styles.tokenChange,
                  t.change24h > 0
                    ? styles.changeMint
                    : t.change24h < 0
                      ? styles.changeRed
                      : styles.changeTxt3,
                )}
              >
                {formatPercent(t.change24h)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
