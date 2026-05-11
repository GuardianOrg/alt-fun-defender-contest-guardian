import styles from "./EarningsPanel.module.css";
import { FEES } from "../../config/constants";
import { cn, formatCurveFilled, formatUsd, shortenAddress } from "../../utils/format";
import Button from "../shared/Button";
import Skeleton from "../shared/Skeleton";

import type { CreatorEarnings } from "../../services/types";

const EXPLORER_BASE = "https://hyperevmscan.io/address";

// Number of skeleton token cards shown during the initial earnings fetch.
// 2 keeps the panel feeling populated without spilling under the
// claim/total summary on common viewport heights.
const REWARDS_SKELETON_COUNT = 2;

interface Props {
  earnings: CreatorEarnings | undefined;
  claiming: boolean;
  isLoading?: boolean;
  /**
   * Claim the caller's pooled USDC fees from `FeeVault`. Always drains the
   * full balance — per-token targeting no longer exists in the router-fee
   * model (fees are pooled across all of a creator's tokens).
   */
  claim: () => void;
  onTokenClick: (addr: string) => void;
  onLaunch: () => void;
}

export default function RewardsTab({
  earnings,
  claiming,
  claim,
  isLoading = false,
  onTokenClick,
  onLaunch,
}: Props) {
  // Loading state mirrors the live layout (summary card + per-token cards)
  // so users get a shaped placeholder instead of the "No tokens created
  // yet" empty state flashing while the first fetch is still in flight.
  if (isLoading && !earnings) {
    return (
      <div aria-busy="true" aria-label="Loading creator rewards">
        <div className={styles.rewardsSummary}>
          <div className={styles.rewardsGrid}>
            <div>
              <div className={styles.rewardsLabel}>claimable</div>
              <Skeleton width="5rem" height="1.5rem" />
            </div>
            <div>
              <div className={styles.rewardsLabel}>total earned</div>
              <Skeleton width="5rem" height="1.5rem" />
            </div>
          </div>
          <Skeleton
            shape="block"
            width="100%"
            height="2.4rem"
            radius="2px"
          />
        </div>

        <div className={styles.tokensSection}>
          <div className={styles.tokensSectionLabel}>your tokens</div>
          <div className={styles.tokensCards}>
            {Array.from({ length: REWARDS_SKELETON_COUNT }, (_, i) => (
              <div key={i} className={styles.tokenCard} aria-hidden="true">
                <div className={styles.tokenCardHeader}>
                  <Skeleton
                    shape="block"
                    width="2rem"
                    height="2rem"
                    radius="2px"
                  />
                  <div className={styles.tokenCardInfo}>
                    <Skeleton width="6rem" height="13px" />
                    <Skeleton
                      width="5rem"
                      height="11px"
                      className={styles.skeletonSublineLg}
                    />
                  </div>
                  <Skeleton width="3.5rem" height="14px" />
                </div>
                <div className={styles.tokenCardGrid}>
                  <div>
                    <div className={styles.tokenCardStatLabel}>volume</div>
                    <Skeleton width="4rem" height="13px" />
                  </div>
                  <div>
                    <div className={styles.tokenCardStatLabel}>earned</div>
                    <Skeleton width="4rem" height="13px" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

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
        <Button variant="primary" onClick={onLaunch}>
          &#x26A1; Launch a token
        </Button>
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

        <Button
          variant="primary"
          fullWidth
          busy={claiming}
          disabled={earnings.totalClaimable <= 0}
          onClick={() => claim()}
        >
          {claiming
            ? "Claiming\u2026"
            : earnings.totalClaimable > 0
              ? `Claim $${earnings.totalClaimable.toFixed(2)} USDC`
              : "Nothing to claim"}
        </Button>

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
                {t.imageUrl ? (
                  <img
                    src={t.imageUrl}
                    alt=""
                    className={styles.tokenCardImage}
                  />
                ) : (
                  <div className={styles.tokenCardImagePlaceholder}>
                    {t.name.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className={styles.tokenCardInfo}>
                  <div className={styles.tokenCardName}>{t.name}</div>
                  <a
                    href={`${EXPLORER_BASE}/${t.address}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.tokenCardLtLink}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {shortenAddress(t.address)}
                    {t.address.startsWith("0x") && (
                      <svg
                        width="10"
                        height="10"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className={styles.tokenCardLtLinkIcon}
                      >
                        <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                        <polyline points="15 3 21 3 21 9" />
                        <line x1="10" y1="14" x2="21" y2="3" />
                      </svg>
                    )}
                  </a>
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
              </div>

              {t.status !== "graduated" && (
                <div className={styles.curveBar}>
                  <div className={styles.curveTrack}>
                    <div
                      className={cn(styles.curveFill, "bar-glow-mint")}
                      style={{ width: `${t.curveFilled ?? 0}%` }}
                    />
                  </div>
                  <div className={styles.curveLabel}>
                    {formatCurveFilled(t.curveFilled)} progress
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
