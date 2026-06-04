import styles from "./EarningsPanel.module.css";
import {
  cn,
  formatPercentOrDash,
  formatTokenAmount,
  formatUsd,
} from "../../utils/format";
import Button from "../shared/Button";
import Skeleton from "../shared/Skeleton";

import type { HeldToken } from "../../services/types";

// Number of skeleton rows shown during the initial balances fetch. Picked
// to fill the visible card height without dominating the panel — anything
// beyond this scrolls into view as real tokens land.
const BALANCE_SKELETON_COUNT = 4;

interface Props {
  tokens: HeldToken[];
  totalValue: number;
  isLoading?: boolean;
  onTokenClick: (addr: string) => void;
  onLaunch: () => void;
}

export default function BalancesTab({
  tokens,
  totalValue,
  isLoading = false,
  onTokenClick,
  onLaunch,
}: Props) {
  // Render skeletons during the initial fetch so the panel doesn't flash
  // the "No tokens yet" empty state before balances finish loading. Once
  // the first response lands, `tokens.length === 0` is the source of truth
  // for the real empty state.
  if (isLoading && tokens.length === 0) {
    return (
      <div aria-busy="true" aria-label="Loading balances">
        <div className={styles.totalValueWrap}>
          <div className={cn(styles.totalValueLabel, "ui-subheading")}>
            total value
          </div>
          <Skeleton width="6rem" height="1.5rem" />
        </div>
        <div className={cn(styles.listHeader, "ui-subheading")}>
          <span className={styles.listHeaderLeft}>Coins</span>
          <span className={styles.listHeaderRight}>Value</span>
        </div>
        <div className={styles.tokenList}>
          {Array.from({ length: BALANCE_SKELETON_COUNT }, (_, i) => (
            <div key={i} className={styles.tokenRow} aria-hidden="true">
              <Skeleton shape="circle" width="1.5rem" />
              <div className={styles.tokenInfo}>
                <Skeleton width="5rem" height="12px" />
                <Skeleton
                  width="6rem"
                  height="10px"
                  className={styles.skeletonSubline}
                />
              </div>
              <div className={styles.tokenValueWrap}>
                <Skeleton width="3.5rem" height="12px" />
                <Skeleton
                  width="2.5rem"
                  height="10px"
                  className={styles.skeletonSubline}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

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
        <div className={cn(styles.totalValueLabel, "ui-subheading")}>
          total value
        </div>
        <div className={styles.totalValueAmount}>{formatUsd(totalValue)}</div>
      </div>

      <div className={cn(styles.listHeader, "ui-subheading")}>
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
                  t.change24h !== null && t.change24h > 0
                    ? styles.changeMint
                    : t.change24h !== null && t.change24h < 0
                      ? styles.changeRed
                      : styles.changeTxt3,
                )}
              >
                {formatPercentOrDash(t.change24h)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
