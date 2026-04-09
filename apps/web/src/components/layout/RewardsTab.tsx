import styles from "./EarningsPanel.module.css";
import { FEES } from "../../config/constants";
import { cn, formatUsd } from "../../utils/format";

import type { CreatorEarnings } from "../../services/types";

interface Props {
  earnings: CreatorEarnings | undefined;
  claiming: boolean;
  claim: (tokenAddress?: string) => void;
  onTokenClick: (addr: string) => void;
  onLaunch: () => void;
}

export default function RewardsTab({
  earnings,
  claiming,
  claim,
  onTokenClick,
  onLaunch,
}: Props) {
  if (!earnings || earnings.tokens.length === 0) {
    return (
      <div className={styles.emptyState}>
        <div className={styles.emptyIcon}>&#x26A1;</div>
        <div className={styles.textCenter}>
          <div className={styles.emptyTitle}>No tokens created yet</div>
          <div className={styles.emptyText}>
            Launch a levered token to start earning {FEES.creatorSplit * 100}% of
            all trading volume on the bonding curve. Fees accrue in USDC and can
            be claimed anytime.
          </div>
        </div>
        <button className={styles.launchBtn} onClick={onLaunch}>
          &#x26A1; Launch a token
        </button>
      </div>
    );
  }

  return (
    <>
      <div className={styles.rewardsSummary}>
        <div className={styles.rewardsGrid}>
          <div>
            <div className={styles.rewardsLabel}>claimable</div>
            <div className={styles.rewardsClaimable}>
              ${earnings.totalClaimable.toFixed(2)}
            </div>
          </div>
          <div>
            <div className={styles.rewardsLabel}>total earned</div>
            <div className={styles.rewardsTotalEarned}>
              ${earnings.totalEarned.toFixed(2)}
            </div>
          </div>
        </div>

        <button
          className={cn(
            styles.claimBtn,
            earnings.totalClaimable > 0
              ? styles.claimBtnActive
              : styles.claimBtnDisabled,
            claiming && styles.claiming,
          )}
          onClick={() => claim()}
          disabled={earnings.totalClaimable <= 0 || claiming}
        >
          {claiming
            ? "Claiming\u2026"
            : earnings.totalClaimable > 0
              ? `Claim $${earnings.totalClaimable.toFixed(2)} USDC`
              : "Nothing to claim"}
        </button>

        {claiming && (
          <div className={styles.claimingIndicator}>
            <div className={styles.claimingDot} />
            Confirm in wallet&hellip;
          </div>
        )}

        <div className={styles.prevClaimed}>
          <span>previously claimed</span>
          <span className={styles.prevClaimedValue}>
            ${earnings.totalClaimed.toFixed(2)}
          </span>
        </div>
      </div>

      <div className={styles.tokensSection}>
        <div className={styles.tokensSectionLabel}>
          your tokens ({earnings.tokens.length})
        </div>

        <div className={styles.tokensCards}>
          {earnings.tokens.map((t) => (
            <div
              key={t.address}
              className={styles.tokenCard}
              onClick={() => onTokenClick(t.address)}
            >
              <div className={styles.tokenCardHeader}>
                <span className={styles.tokenCardEmoji}>{t.emoji}</span>
                <div className={styles.tokenCardInfo}>
                  <div className={styles.tokenCardName}>{t.name}</div>
                  <div className={styles.tokenCardLtName}>{t.ltName}</div>
                </div>
                <div
                  className={cn(
                    styles.statusBadge,
                    t.status === "graduating" && styles.statusGraduating,
                    t.status === "graduated" && styles.statusGraduated,
                    t.status === "active" && styles.statusActive,
                  )}
                >
                  {t.status}
                </div>
              </div>

              <div className={styles.tokenCardGrid}>
                <div>
                  <div className={styles.tokenCardStatLabel}>volume</div>
                  <div className={styles.tokenCardStatValue}>
                    {formatUsd(t.totalVolumeUsd)}
                  </div>
                </div>
                <div>
                  <div className={styles.tokenCardStatLabel}>earned</div>
                  <div className={styles.tokenCardStatValue}>
                    ${t.feesEarnedUsd.toFixed(2)}
                  </div>
                </div>
                <div>
                  <div className={styles.tokenCardStatLabel}>claimable</div>
                  <div className={styles.tokenCardStatValueMint}>
                    ${t.feesClaimableUsd.toFixed(2)}
                  </div>
                </div>
              </div>

              {t.status !== "graduated" && (
                <div className={styles.curveBar}>
                  <div className={styles.curveTrack}>
                    <div
                      className={cn(styles.curveFill, "bar-glow-mint")}
                      style={{ width: `${t.curveFilled}%` }}
                    />
                  </div>
                  <div className={styles.curveLabel}>
                    {t.curveFilled}% filled
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className={styles.footer}>
        <div className={styles.footerText}>
          <span className={styles.footerHighlight}>
            {FEES.creatorSplit * 100}%
          </span>{" "}
          of all curve volume goes to token creators. Fees accrue in USDC and
          can be claimed anytime.
        </div>
      </div>
    </>
  );
}
