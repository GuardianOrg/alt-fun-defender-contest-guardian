import styles from "./DecompPanel.module.css";
import { cn, formatPercent } from "../../utils/format";

import type { Token } from "../../services/types";

interface Props {
  token: Token;
}

export default function DecompPanel({ token }: Props) {
  const shareDecomp = () => {
    const txt = `${token.name} ${formatPercent(token.change24h)} today\n${formatPercent(token.buyMomentum)} buys · ${formatPercent(token.leverageBoost)} leverage boost\n\nperps × memes — bounce.fun`;
    navigator.clipboard.writeText(txt).catch(() => {});
  };

  const underlyingChg = token.leverageBoost / token.leverage;

  return (
    <div className={styles.wrapper}>
      <div className={styles.row}>
        <div
          className={cn(
            styles.card,
            token.change24h >= 0 ? styles.cardMint : styles.cardRed,
          )}
        >
          <div className={styles.cardLabel}>total 24h</div>
          <div
            className={cn(
              styles.cardValue,
              token.change24h >= 0 ? styles.cardValueMint : styles.cardValueRed,
            )}
          >
            {formatPercent(token.change24h)}
          </div>
        </div>

        <div className={styles.cardBorder}>
          <div className={styles.cardLabel}>buy momentum</div>
          <div
            className={cn(
              styles.cardValue,
              token.buyMomentum >= 0
                ? styles.cardValueMint
                : styles.cardValueRed,
            )}
          >
            {formatPercent(token.buyMomentum)}
          </div>
          <div className={styles.cardDetail}>trade activity</div>
        </div>

        <div className={styles.levCard}>
          <div className={styles.cardLabel}>leverage boost</div>
          <div className={styles.levValue}>
            {formatPercent(token.leverageBoost)}
          </div>
          <div className={styles.levDetail}>
            {formatPercent(underlyingChg)} × {token.leverage}×
          </div>
        </div>

        <button className={styles.shareBtn} onClick={shareDecomp}>
          <span className={styles.shareIcon}>↗</span>
          share
        </button>
      </div>
    </div>
  );
}
