import { useState } from "react";
import type { KeyboardEvent } from "react";

import { useNavigate } from "react-router";

import ManageWalletTab from "./ManageWalletTab";
import styles from "./ProfileView.module.css";
import TransferOwnershipTab from "./TransferOwnershipTab";
import { CREATE_PATH, HOME_ROUTE, tokenPath } from "../../app/routes";
import { CREATOR_FEE_SHARE_PCT } from "../../config/constants";
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
import { srcSetFor, transformImageUrl } from "../../utils/image";
import { cycleProfileFace, useProfileFace } from "../../utils/profileFace";
import Button from "../shared/Button";
import CopyAddressButton from "../shared/CopyAddressButton";
import Skeleton from "../shared/Skeleton";

import type { CreatedToken, HeldToken } from "../../services/types";

type ProfileTab = "balances" | "wallet" | "rewards" | "transfer";

const TABS: { label: string; tab: ProfileTab }[] = [
  { label: "BALANCES", tab: "balances" },
  { label: "CREATOR REWARDS", tab: "rewards" },
  { label: "TRANSFER OWNERSHIP", tab: "transfer" },
  { label: "MANAGE WALLET", tab: "wallet" },
];

interface EmptyStateContent {
  title: string;
  body: string;
  ctaLabel: string;
  ctaHref: string;
}

const EMPTY_STATES: Record<"balances" | "rewards", EmptyStateContent> = {
  balances: {
    title: "No tokens yet",
    body: "Tokens you hold from the bonding curve or post-graduation pools will appear here.",
    ctaLabel: "Browse tokens",
    ctaHref: HOME_ROUTE,
  },
  rewards: {
    title: "No tokens created yet",
    body: `Launch an altcoin to start earning ${CREATOR_FEE_SHARE_PCT}% of all trading fees. Fees accrue in USDC and can be claimed anytime.`,
    ctaLabel: "Launch a token",
    ctaHref: CREATE_PATH,
  },
};

const BALANCE_SKELETON_COUNT = 5;

const REWARDS_SKELETON_COUNT = 2;

export default function ProfileView() {
  const navigate = useNavigate();
  const { address, shortAddress, isConnected, disconnect } = useWallet();
  const face = useProfileFace();
  const [activeTab, setActiveTab] = useState<ProfileTab>("balances");

  // Navigate before async disconnect so the profile never sits in an empty logged-out state.
  const handleDisconnect = () => {
    navigate(HOME_ROUTE);
    void disconnect();
  };

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
    refetch: refetchEarnings,
  } = useCreatorEarnings();
  // Rewards and ownership transfer both depend on the same created-token list.
  const hasCreatedTokens =
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
    // Avoid flashing the empty state during the initial fetch.
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
    // Avoid flashing "No tokens created yet" during the initial rewards fetch.
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
        <RewardsFooter />
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
        {isConnected && (
          <Button
            variant="secondary"
            size="sm"
            className={styles.disconnectBtn}
            onClick={handleDisconnect}
            aria-label="Disconnect wallet"
          >
            <svg
              aria-hidden="true"
              focusable="false"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            <span>Disconnect</span>
          </Button>
        )}
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
            (activeTab === "wallet" && isConnected) ||
            (activeTab === "rewards" && hasCreatedTokens) ||
            (activeTab === "transfer" && hasCreatedTokens)) &&
            styles.contentFlush,
        )}
      >
        {activeTab === "balances" && renderBalances()}
        {activeTab === "wallet" && <ManageWalletTab />}
        {activeTab === "rewards" && renderRewards()}
        {activeTab === "transfer" && (
          <TransferOwnershipTab
            tokens={earnings?.tokens}
            isLoading={earningsLoading}
            walletConnected={isConnected}
            onTransferred={refetchEarnings}
          />
        )}
      </div>
    </div>
  );
}

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
              src={transformImageUrl(token.image, { width: 64 })}
              srcSet={srcSetFor(token.image, 64) || undefined}
              alt=""
              width={64}
              height={64}
              className={styles.balanceLogo}
              onError={() => setImgError(true)}
              loading="lazy"
              decoding="async"
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
        // Copying the contract address should not also navigate the row.
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
      <div className={styles.rewardsHero}>
        <div className={styles.rewardsLabel}>claimable</div>
        <div className={styles.rewardsClaimable}>
          ${totalClaimable.toFixed(2)}
        </div>
      </div>

      <div className={styles.rewardsCtaWrap}>
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
      </div>

      <div className={styles.rewardsStats}>
        <div className={styles.rewardsStat}>
          <div className={styles.rewardsLabel}>total earned</div>
          <div className={styles.rewardsStatValue}>
            ${totalEarned.toFixed(2)}
          </div>
        </div>
        <div className={styles.rewardsStat}>
          <div className={styles.rewardsLabel}>previously claimed</div>
          <div className={styles.rewardsStatValue}>
            ${totalClaimed.toFixed(2)}
          </div>
        </div>
      </div>
    </div>
  );
}

function RewardsSummarySkeleton() {
  return (
    <div className={styles.rewardsSummary} aria-hidden="true">
      <div className={styles.rewardsHero}>
        <div className={styles.rewardsLabel}>claimable</div>
        <Skeleton width="8rem" height="2.4rem" />
      </div>
      <div className={styles.rewardsCtaWrap}>
        <Skeleton shape="block" width="100%" height="3rem" radius="3px" />
      </div>
      <div className={styles.rewardsStats}>
        <div className={styles.rewardsStat}>
          <div className={styles.rewardsLabel}>total earned</div>
          <Skeleton width="5rem" height="1.4rem" />
        </div>
        <div className={styles.rewardsStat}>
          <div className={styles.rewardsLabel}>previously claimed</div>
          <Skeleton width="5rem" height="1.4rem" />
        </div>
      </div>
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
              src={transformImageUrl(token.imageUrl, { width: 64 })}
              srcSet={srcSetFor(token.imageUrl, 64) || undefined}
              alt=""
              width={64}
              height={64}
              className={styles.balanceLogo}
              onError={() => setImgError(true)}
              loading="lazy"
              decoding="async"
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
        // Copying the contract address should not also navigate the row.
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

function RewardsFooter() {
  return (
    <div className={styles.rewardsFooter}>
      <div className={styles.rewardsFooterText}>
        <span className={styles.rewardsFooterHighlight}>
          {CREATOR_FEE_SHARE_PCT}%
        </span>{" "}
        of all trading fees go to token creators. Fees accrue in USDC and can
        be claimed anytime.
      </div>
    </div>
  );
}
