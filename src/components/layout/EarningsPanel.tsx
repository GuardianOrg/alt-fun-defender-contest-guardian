import { useState } from "react";

import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router";

import styles from "./EarningsPanel.module.css";
import {
  useCreatorEarnings,
  useBalances,
} from "../../hooks/useCreatorEarnings";
import { useWallet } from "../../hooks/useWallet";
import { selectEarningsOpen, setEarningsOpen } from "../../state/uiSlice";
import {
  cn,
  formatUsd,
  formatPercent,
  formatTokenAmount,
} from "../../utils/format";

type Tab = "balances" | "rewards";

export default function EarningsPanel() {
  const open = useSelector(selectEarningsOpen);
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { isConnected, shortAddress, connect } = useWallet();
  const { earnings, claiming, claim } = useCreatorEarnings();
  const { tokens: heldTokens, totalValue } = useBalances();
  const [tab, setTab] = useState<Tab>("balances");

  if (!open) return null;

  const setOpen = (v: boolean) => dispatch(setEarningsOpen(v));

  const goToToken = (addr: string) => {
    setOpen(false);
    navigate(`/token/${addr}`);
  };

  return (
    <div
      className={styles.overlay}
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className={styles.panel}>
        {/* Panel header */}
        <div className={styles.panelHeader}>
          {isConnected ? (
            <div className={styles.avatarWrap}>
              <img src="/avatar.png" alt="" className={styles.avatar} />
              <div>
                <div className={styles.addressText}>{shortAddress}</div>
                <div className={styles.chainText}>HyperEVM</div>
              </div>
            </div>
          ) : (
            <div className={styles.profileLabel}>profile</div>
          )}
          <button className={styles.escBtn} onClick={() => setOpen(false)}>
            esc
          </button>
        </div>

        {!isConnected ? (
          <div className={styles.notConnected}>
            <div className={styles.emptyIcon}>&#x1F464;</div>
            <div className={styles.textCenter}>
              <div className={styles.emptyTitle}>Connect your wallet</div>
              <div className={styles.emptyText}>
                View your token balances on the curve and claim creator rewards.
              </div>
            </div>
            <button className={styles.connectBtn} onClick={connect}>
              Connect Wallet
            </button>
          </div>
        ) : (
          <>
            {/* Tabs */}
            <div className={styles.tabBar}>
              {(["balances", "rewards"] as const).map((t) => (
                <button
                  key={t}
                  className={cn(
                    styles.tabButton,
                    tab === t && styles.tabButtonActive,
                  )}
                  onClick={() => setTab(t)}
                >
                  {t === "balances" ? "Balances" : "Creator Rewards"}
                  {tab === t && <span className={styles.tabIndicator} />}
                </button>
              ))}
            </div>

            <div className={styles.contentArea}>
              {tab === "balances" ? (
                <BalancesTab
                  tokens={heldTokens}
                  totalValue={totalValue}
                  onTokenClick={goToToken}
                  onLaunch={() => {
                    setOpen(false);
                    navigate("/create");
                  }}
                />
              ) : (
                <RewardsTab
                  earnings={earnings}
                  claiming={claiming}
                  claim={claim}
                  onTokenClick={goToToken}
                  onLaunch={() => {
                    setOpen(false);
                    navigate("/create");
                  }}
                />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ─── Balances tab ─── */

function BalancesTab({
  tokens,
  totalValue,
  onTokenClick,
  onLaunch,
}: {
  tokens: ReturnType<typeof useBalances>["tokens"];
  totalValue: number;
  onTokenClick: (addr: string) => void;
  onLaunch: () => void;
}) {
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
        <button className={styles.launchBtn} onClick={onLaunch}>
          &#x26A1; Launch a token
        </button>
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

/* ─── Creator Rewards tab ─── */

function RewardsTab({
  earnings,
  claiming,
  claim,
  onTokenClick,
  onLaunch,
}: {
  earnings: ReturnType<typeof useCreatorEarnings>["earnings"];
  claiming: boolean;
  claim: (tokenAddress?: string) => void;
  onTokenClick: (addr: string) => void;
  onLaunch: () => void;
}) {
  if (!earnings || earnings.tokens.length === 0) {
    return (
      <div className={styles.emptyState}>
        <div className={styles.emptyIcon}>&#x26A1;</div>
        <div className={styles.textCenter}>
          <div className={styles.emptyTitle}>No tokens created yet</div>
          <div className={styles.emptyText}>
            Launch a levered token to start earning 0.1% of all trading volume
            on the bonding curve. Fees accrue in USDC and can be claimed
            anytime.
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
          <span className={styles.footerHighlight}>0.1%</span> of all curve
          volume goes to token creators. Fees accrue in USDC and can be claimed
          anytime.
        </div>
      </div>
    </>
  );
}
