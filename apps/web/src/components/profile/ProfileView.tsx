import { useState } from "react";
import type { KeyboardEvent } from "react";

import { useNavigate } from "react-router";

import styles from "./ProfileView.module.css";
import { CREATE_PATH, HOME_ROUTE, tokenPath } from "../../app/routes";
import { useBalances } from "../../hooks/useBalances";
import { useCreatorEarnings } from "../../hooks/useCreatorEarnings";
import { useWallet } from "../../hooks/useWallet";
import {
  cn,
  formatPercentOrDash,
  formatTokenAmount,
  formatUsd,
  shortenAddress,
} from "../../utils/format";
import { cycleProfileFace, useProfileFace } from "../../utils/profileFace";
import Button from "../shared/Button";
import CopyAddressButton from "../shared/CopyAddressButton";
import Skeleton from "../shared/Skeleton";

import type { CreatedToken, HeldToken } from "../../services/types";

type ProfileTab = "balances" | "rewards";

const TABS: { label: string; tab: ProfileTab }[] = [
  { label: "BALANCES", tab: "balances" },
  { label: "CREATOR REWARDS", tab: "rewards" },
];

/**
 * Per-tab empty-state copy + CTA. Lives next to the tab list so the
 * mapping is obvious at a glance; the surrounding markup is shared by
 * every tab. The Balances tab swaps this out for the live token list
 * once `useBalances` returns rows.
 */
interface EmptyStateContent {
  title: string;
  body: string;
  ctaLabel: string;
  ctaHref: string;
}

const EMPTY_STATES: Record<ProfileTab, EmptyStateContent> = {
  balances: {
    title: "No tokens yet",
    body: "Tokens you hold from the bonding curve or post-graduation pools will appear here.",
    ctaLabel: "Browse tokens",
    ctaHref: HOME_ROUTE,
  },
  rewards: {
    title: "No tokens created yet",
    body: "Launch an altcoin to start earning a share of trading fees. Fees accrue in USDC and can be claimed anytime.",
    ctaLabel: "Launch a token",
    ctaHref: CREATE_PATH,
  },
};

/** Number of skeleton rows shown during the initial balances fetch.
 * Tuned to roughly fill the visible panel area without dominating it
 * — real rows that exceed this count scroll into view normally. */
const BALANCE_SKELETON_COUNT = 5;

/** Skeleton row count for the rewards tab. Two is plenty: most
 * creators have one or two live tokens at most, and a shorter
 * placeholder stops the panel from feeling artificially crowded
 * before real data lands. */
const REWARDS_SKELETON_COUNT = 2;

export default function ProfileView() {
  const navigate = useNavigate();
  const { address, shortAddress, isConnected } = useWallet();
  const face = useProfileFace();
  const [activeTab, setActiveTab] = useState<ProfileTab>("balances");
  const {
    tokens: heldTokens,
    totalValue,
    isLoading: balancesLoading,
  } = useBalances();
  const {
    earnings,
    isLoading: earningsLoading,
    claiming,
    claim,
  } = useCreatorEarnings();
  const hasRewards =
    !!earnings && earnings.tokens.length > 0;

  const renderEmpty = (content: EmptyStateContent) => (
    <div className={styles.emptyState}>
      <div className={styles.emptyTitle}>{content.title}</div>
      <div className={styles.emptyBody}>{content.body}</div>
      <Button
        variant="primary"
        size="sm"
        onClick={() => navigate(content.ctaHref)}
      >
        {content.ctaLabel}
      </Button>
    </div>
  );

  const renderBalances = () => {
    // Skeleton during the initial fetch so the panel doesn't flash the
    // "No tokens yet" empty state on first paint. Once the first
    // response lands, the empty branch below is the source of truth.
    if (balancesLoading && heldTokens.length === 0) {
      return (
        <div aria-busy="true" aria-label="Loading balances">
          <BalancesSummarySkeleton />
          <div className={styles.tableScroll}>
            <BalancesListHeader />
            <div className={styles.balanceList}>
              {Array.from({ length: BALANCE_SKELETON_COUNT }, (_, i) => (
                <BalanceRowSkeleton key={i} />
              ))}
            </div>
          </div>
        </div>
      );
    }

    if (heldTokens.length === 0) {
      return renderEmpty(EMPTY_STATES.balances);
    }

    return (
      <>
        <BalancesSummary totalValue={totalValue} />
        <div className={styles.tableScroll}>
          <BalancesListHeader />
          <div className={styles.balanceList}>
            {heldTokens.map((t) => (
              <BalanceRow
                key={t.address}
                token={t}
                onClick={() => navigate(tokenPath(t.address))}
              />
            ))}
          </div>
        </div>
      </>
    );
  };

  const renderRewards = () => {
    // Skeleton-first paint mirrors balances: the rewards summary +
    // per-token rows show shaped placeholders while the initial
    // `useCreatorEarnings` fetch is in-flight so the panel doesn't
    // flash "No tokens created yet" for users who do, in fact, have
    // tokens.
    if (earningsLoading && !earnings) {
      return (
        <div aria-busy="true" aria-label="Loading creator rewards">
          <RewardsSummarySkeleton />
          <div className={styles.tableScroll}>
            <RewardsListHeader />
            <div className={styles.balanceList}>
              {Array.from({ length: REWARDS_SKELETON_COUNT }, (_, i) => (
                <RewardsRowSkeleton key={i} />
              ))}
            </div>
          </div>
        </div>
      );
    }

    if (!earnings || earnings.tokens.length === 0) {
      return renderEmpty(EMPTY_STATES.rewards);
    }

    return (
      <>
        <RewardsSummary
          totalClaimable={earnings.totalClaimable}
          totalEarned={earnings.totalEarned}
          totalClaimed={earnings.totalClaimed}
          claiming={claiming}
          onClaim={claim}
        />
        <div className={styles.tableScroll}>
          <RewardsListHeader />
          <div className={styles.balanceList}>
            {earnings.tokens.map((t) => (
              <RewardsRow
                key={t.address}
                token={t}
                onClick={() => navigate(tokenPath(t.address))}
              />
            ))}
          </div>
        </div>
      </>
    );
  };

  return (
    <div className={styles.panel}>
      <div className={styles.hero}>
        <button
          type="button"
          className={styles.avatar}
          onClick={cycleProfileFace}
          title="Click to change face"
          aria-label="Change profile face"
        >
          <span className={styles.avatarFace}>{face}</span>
        </button>
        <div className={styles.identity}>
          <div className={styles.label}>profile</div>
          <div className={styles.addressRow}>
            <span className={styles.address} title={address}>
              {isConnected ? shortAddress : "not connected"}
            </span>
            {isConnected && address && (
              <>
                <CopyAddressButton address={address} stopPropagation={false} />
                <a
                  href={`https://hyperevmscan.io/address/${address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.explorerLink}
                  aria-label={`View ${address} on hyperevm scan`}
                >
                  View on hyperevm scan
                  <svg
                    className={styles.explorerLinkIcon}
                    aria-hidden="true"
                    focusable="false"
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                </a>
              </>
            )}
          </div>
        </div>
      </div>

      <div className={styles.tabBar}>
        {TABS.map((t) => (
          <button
            key={t.tab}
            type="button"
            className={cn(styles.tab, activeTab === t.tab && styles.tabActive)}
            onClick={() => setActiveTab(t.tab)}
          >
            <span>{t.label}</span>
            {activeTab === t.tab && (
              <span className={styles.indicator} aria-hidden="true" />
            )}
          </button>
        ))}
      </div>

      <div
        className={cn(
          styles.content,
          ((activeTab === "balances" && heldTokens.length > 0) ||
            (activeTab === "rewards" && hasRewards)) &&
            styles.contentFlush,
        )}
      >
        {activeTab === "balances" ? renderBalances() : renderRewards()}
      </div>
    </div>
  );
}

/* ---------- Balances sub-components ---------- */

function BalancesSummary({ totalValue }: { totalValue: number }) {
  return (
    <div className={styles.balanceSummary}>
      <div className={styles.balanceSummaryLabel}>total value</div>
      <div className={styles.balanceSummaryValue}>
        {formatUsd(totalValue)}
      </div>
    </div>
  );
}

function BalancesSummarySkeleton() {
  return (
    <div className={styles.balanceSummary} aria-hidden="true">
      <div className={styles.balanceSummaryLabel}>total value</div>
      <Skeleton width="8rem" height="1.6rem" />
    </div>
  );
}

function BalancesListHeader() {
  return (
    <div className={styles.balanceHeader}>
      <span>Altcoin</span>
      <span className={styles.balanceHeadAddress}>Address</span>
      <span className={styles.balanceHeadAmount}>Amount</span>
      <span className={styles.balanceHeadChange}>24H</span>
      <span className={styles.balanceHeadValue}>Value</span>
    </div>
  );
}

interface BalanceRowProps {
  token: HeldToken;
  onClick: () => void;
}

function BalanceRow({ token, onClick }: BalanceRowProps) {
  const [imgError, setImgError] = useState(false);
  const change = token.change24h;
  const changeClass =
    change === null
      ? styles.balanceChangeNeutral
      : change > 0
        ? styles.balanceChangeUp
        : change < 0
          ? styles.balanceChangeDown
          : styles.balanceChangeNeutral;

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onClick();
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      className={styles.balanceRow}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      aria-label={`Open ${token.name}`}
    >
      <div className={styles.balanceTokenCell}>
        <div className={styles.balanceLogoWrap}>
          {token.image && !imgError ? (
            <img
              src={token.image}
              alt=""
              className={styles.balanceLogo}
              onError={() => setImgError(true)}
            />
          ) : (
            <span className={styles.balanceLogoFallback} aria-hidden="true">
              {token.emoji || "🪙"}
            </span>
          )}
        </div>
        <div className={styles.balanceTokenMeta}>
          <span className={styles.balanceTokenTicker}>{token.ticker}</span>
          <span className={styles.balanceTokenName}>{token.name}</span>
        </div>
      </div>
      <div
        className={styles.balanceAddress}
        // Keep click + keydown from bubbling to the row's navigate
        // handler so the user can copy the contract address without
        // also being teleported to the token page mid-interaction.
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") e.stopPropagation();
        }}
      >
        <span className={styles.balanceAddressText}>
          {shortenAddress(token.address)}
        </span>
        <CopyAddressButton address={token.address} />
      </div>
      <div className={styles.balanceAmount}>
        <span className={styles.balanceAmountValue}>
          {formatTokenAmount(token.amount)}
        </span>
        <span className={styles.balanceAmountTicker}>{token.ticker}</span>
      </div>
      <div className={cn(styles.balanceChange, changeClass)}>
        {formatPercentOrDash(change)}
      </div>
      <div className={styles.balanceValue}>{formatUsd(token.valueUsd)}</div>
    </div>
  );
}

function BalanceRowSkeleton() {
  return (
    <div className={styles.balanceRow} aria-hidden="true">
      <div className={styles.balanceTokenCell}>
        <div className={styles.balanceLogoWrap}>
          <Skeleton shape="block" width="4rem" height="4rem" radius="3px" />
        </div>
        <div className={styles.balanceTokenMeta}>
          <Skeleton width="4rem" height="15px" />
          <Skeleton width="7rem" height="12px" />
        </div>
      </div>
      <div className={styles.balanceAddress}>
        <Skeleton width="6rem" height="12px" />
      </div>
      <div className={styles.balanceAmount}>
        <Skeleton width="4rem" height="12px" />
      </div>
      <div className={styles.balanceChange}>
        <Skeleton width="3rem" height="12px" />
      </div>
      <div className={styles.balanceValue}>
        <Skeleton width="4rem" height="12px" />
      </div>
    </div>
  );
}

/* ---------- Creator Rewards sub-components ---------- */

/**
 * Summary strip above the per-token list. Surfaces the two figures
 * a creator checks most often (`claimable` and `total earned`),
 * exposes a single-call drain via `Claim $X USDC`, and tucks the
 * historic `previously claimed` total beneath a divider so it never
 * competes with the live numbers above. Mirrors the EarningsPanel
 * `RewardsTab` semantically; visuals are tuned for the wider Profile
 * panel.
 */
interface RewardsSummaryProps {
  totalClaimable: number;
  totalEarned: number;
  totalClaimed: number;
  claiming: boolean;
  onClaim: () => void;
}

function RewardsSummary({
  totalClaimable,
  totalEarned,
  totalClaimed,
  claiming,
  onClaim,
}: RewardsSummaryProps) {
  return (
    <div className={styles.rewardsSummary}>
      <div className={styles.rewardsGrid}>
        <div>
          <div className={styles.rewardsLabel}>claimable</div>
          <div className={styles.rewardsClaimable}>
            ${totalClaimable.toFixed(2)}
          </div>
        </div>
        <div>
          <div className={styles.rewardsLabel}>total earned</div>
          <div className={styles.rewardsTotalEarned}>
            ${totalEarned.toFixed(2)}
          </div>
        </div>
      </div>

      <Button
        variant="primary"
        fullWidth
        busy={claiming}
        disabled={totalClaimable <= 0}
        onClick={onClaim}
      >
        {claiming
          ? "Claiming\u2026"
          : totalClaimable > 0
            ? `Claim $${totalClaimable.toFixed(2)} USDC`
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
          ${totalClaimed.toFixed(2)}
        </span>
      </div>
    </div>
  );
}

function RewardsSummarySkeleton() {
  return (
    <div className={styles.rewardsSummary} aria-hidden="true">
      <div className={styles.rewardsGrid}>
        <div>
          <div className={styles.rewardsLabel}>claimable</div>
          <Skeleton width="6rem" height="2rem" />
        </div>
        <div>
          <div className={styles.rewardsLabel}>total earned</div>
          <Skeleton width="6rem" height="2rem" />
        </div>
      </div>
      <Skeleton shape="block" width="100%" height="3rem" radius="3px" />
    </div>
  );
}

function RewardsListHeader() {
  return (
    <div className={styles.rewardsHeader}>
      <span>Altcoin</span>
      <span className={styles.balanceHeadAddress}>Address</span>
      <span>Volume</span>
      <span>Earned</span>
    </div>
  );
}

interface RewardsRowProps {
  token: CreatedToken;
  onClick: () => void;
}

function RewardsRow({ token, onClick }: RewardsRowProps) {
  const [imgError, setImgError] = useState(false);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onClick();
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      className={styles.rewardsRow}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      aria-label={`Open ${token.name}`}
    >
      <div className={styles.balanceTokenCell}>
        <div className={styles.balanceLogoWrap}>
          {token.imageUrl && !imgError ? (
            <img
              src={token.imageUrl}
              alt=""
              className={styles.balanceLogo}
              onError={() => setImgError(true)}
            />
          ) : (
            <span className={styles.balanceLogoFallback} aria-hidden="true">
              {token.name.charAt(0).toUpperCase()}
            </span>
          )}
        </div>
        <div className={styles.balanceTokenMeta}>
          <span className={styles.balanceTokenTicker}>{token.ticker}</span>
          <span className={styles.balanceTokenName}>{token.name}</span>
        </div>
      </div>
      <div
        className={styles.balanceAddress}
        // Same stop-propagation pattern as the balances table: copying
        // an address shouldn't double as "navigate to token page".
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") e.stopPropagation();
        }}
      >
        <span className={styles.balanceAddressText}>
          {shortenAddress(token.address)}
        </span>
        <CopyAddressButton address={token.address} />
      </div>
      <div className={styles.balanceValue}>
        {formatUsd(token.totalVolumeUsd)}
      </div>
      <div className={styles.balanceValue}>
        ${token.feesEarnedUsd.toFixed(2)}
      </div>
    </div>
  );
}

function RewardsRowSkeleton() {
  return (
    <div className={styles.rewardsRow} aria-hidden="true">
      <div className={styles.balanceTokenCell}>
        <div className={styles.balanceLogoWrap}>
          <Skeleton shape="block" width="4rem" height="4rem" radius="3px" />
        </div>
        <div className={styles.balanceTokenMeta}>
          <Skeleton width="6rem" height="15px" />
          <Skeleton width="5rem" height="12px" />
        </div>
      </div>
      <div className={styles.balanceAddress}>
        <Skeleton width="6rem" height="12px" />
      </div>
      <div className={styles.balanceValue}>
        <Skeleton width="4rem" height="12px" />
      </div>
      <div className={styles.balanceValue}>
        <Skeleton width="4rem" height="12px" />
      </div>
    </div>
  );
}
