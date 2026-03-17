import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUIStore } from '@/stores/uiStore';
import { useCreatorEarnings, useBalances } from '@/hooks/useCreatorEarnings';
import { useWallet } from '@/hooks/useWallet';
import { cn, formatUsd, formatPercent, formatTokenAmount, shortenAddress } from '@/utils/format';

type Tab = 'balances' | 'rewards';

export default function EarningsPanel() {
  const open = useUIStore((s) => s.earningsOpen);
  const setOpen = useUIStore((s) => s.setEarningsOpen);
  const navigate = useNavigate();
  const { isConnected, address, shortAddress, connect } = useWallet();
  const { earnings, claiming, claim } = useCreatorEarnings();
  const { tokens: heldTokens, totalValue } = useBalances();
  const [tab, setTab] = useState<Tab>('balances');

  if (!open) return null;

  const goToToken = (addr: string) => {
    setOpen(false);
    navigate(`/token/${addr}`);
  };

  return (
    <div
      className="fixed inset-0 z-[900] bg-black/50 backdrop-blur-sm flex justify-end"
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="w-[380px] h-full bg-bg-1 border-l border-border-2 flex flex-col animate-modalin overflow-hidden">
        {/* Panel header — wallet identity */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-2 shrink-0">
          {isConnected ? (
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-full bg-mint/20 flex items-center justify-center text-[13px] text-mint font-bold">
                {shortAddress?.slice(0, 2)}
              </div>
              <div>
                <div className="text-[13px] font-bold text-txt">{shortAddress}</div>
                <div className="text-[11px] text-txt-3">HyperEVM</div>
              </div>
            </div>
          ) : (
            <div className="text-[11px] tracking-[0.14em] uppercase text-mint font-semibold">
              profile
            </div>
          )}
          <button
            className="text-[12px] text-txt-3 bg-white/[0.06] border border-border rounded-sm px-2 py-px cursor-pointer hover:text-txt"
            onClick={() => setOpen(false)}
          >
            esc
          </button>
        </div>

        {!isConnected ? (
          <div className="flex-1 flex flex-col items-center justify-center px-8 gap-4">
            <div className="text-3xl">👤</div>
            <div className="text-center">
              <div className="text-sm font-semibold text-txt mb-1">Connect your wallet</div>
              <div className="text-[12px] text-txt-3 leading-[1.6]">
                View your token balances on the curve and claim creator rewards.
              </div>
            </div>
            <button
              className="font-mono text-[13px] font-bold text-bg bg-mint px-6 py-2.5 rounded-sm border-0 tracking-[0.06em] uppercase cursor-pointer transition-all hover:bg-[#6ef0c6]"
              onClick={connect}
            >
              Connect Wallet
            </button>
          </div>
        ) : (
          <>
            {/* Tabs */}
            <div className="grid grid-cols-2 shrink-0 border-b border-border">
              {(['balances', 'rewards'] as const).map((t) => (
                <button
                  key={t}
                  className={cn(
                    'h-9 flex items-center justify-center text-[12px] font-bold tracking-[0.08em] uppercase cursor-pointer border-0 bg-transparent font-mono text-txt-3 border-b-2 border-b-transparent transition-all',
                    tab === t && 'text-mint bg-mint/[0.06] border-b-mint',
                  )}
                  onClick={() => setTab(t)}
                >
                  {t === 'balances' ? 'Balances' : 'Creator Rewards'}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto">
              {tab === 'balances' ? (
                <BalancesTab
                  tokens={heldTokens}
                  totalValue={totalValue}
                  onTokenClick={goToToken}
                  onLaunch={() => {
                    setOpen(false);
                    navigate('/create');
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
                    navigate('/create');
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
  tokens: ReturnType<typeof useBalances>['tokens'];
  totalValue: number;
  onTokenClick: (addr: string) => void;
  onLaunch: () => void;
}) {
  if (tokens.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-8 py-16 gap-4">
        <div className="text-3xl">📭</div>
        <div className="text-center">
          <div className="text-sm font-semibold text-txt mb-1">No tokens yet</div>
          <div className="text-[12px] text-txt-3 leading-[1.6]">
            Buy tokens on the bonding curve or launch your own levered memecoin.
          </div>
        </div>
        <button
          className="font-mono text-[13px] font-bold text-bg bg-mint px-6 py-2.5 rounded-sm border-0 tracking-[0.06em] uppercase cursor-pointer transition-all hover:bg-[#6ef0c2]"
          onClick={onLaunch}
        >
          ⚡ Launch a token
        </button>
      </div>
    );
  }

  return (
    <>
      {/* Total value header */}
      <div className="px-4 py-4 border-b border-border">
        <div className="text-[11px] tracking-[0.1em] uppercase text-txt-3 mb-1">total value</div>
        <div className="font-display text-2xl font-bold text-txt leading-none">
          {formatUsd(totalValue)}
        </div>
      </div>

      {/* Column headers */}
      <div className="flex items-center px-4 py-2 text-[10px] tracking-[0.12em] uppercase text-txt-3 border-b border-border">
        <span className="flex-1">Coins</span>
        <span className="w-[72px] text-right">Value</span>
      </div>

      {/* Token list */}
      <div className="flex flex-col">
        {tokens.map((t) => (
          <div
            key={t.address}
            className="flex items-center px-4 py-3 border-b border-border cursor-pointer transition-all hover:bg-white/[0.02]"
            onClick={() => onTokenClick(t.address)}
          >
            <span className="text-xl mr-3">{t.emoji}</span>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-bold text-txt truncate">{t.name}</div>
              <div className="text-[12px] text-txt-3">
                {formatTokenAmount(t.amount)} {t.ticker}
              </div>
            </div>
            <div className="text-right ml-3">
              <div className="text-[13px] font-semibold text-txt">{formatUsd(t.valueUsd)}</div>
              <div
                className={cn(
                  'text-[12px] font-medium',
                  t.change24h > 0 ? 'text-mint' : t.change24h < 0 ? 'text-red' : 'text-txt-3',
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
  earnings: ReturnType<typeof useCreatorEarnings>['earnings'];
  claiming: boolean;
  claim: (tokenAddress?: string) => void;
  onTokenClick: (addr: string) => void;
  onLaunch: () => void;
}) {
  if (!earnings || earnings.tokens.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-8 py-16 gap-4">
        <div className="text-3xl">⚡</div>
        <div className="text-center">
          <div className="text-sm font-semibold text-txt mb-1">No tokens created yet</div>
          <div className="text-[12px] text-txt-3 leading-[1.6]">
            Launch a levered memecoin to start earning 0.1% of all trading volume on the
            bonding curve. Fees accrue in USDC and can be claimed anytime.
          </div>
        </div>
        <button
          className="font-mono text-[13px] font-bold text-bg bg-mint px-6 py-2.5 rounded-sm border-0 tracking-[0.06em] uppercase cursor-pointer transition-all hover:bg-[#6ef0c2]"
          onClick={onLaunch}
        >
          ⚡ Launch a token
        </button>
      </div>
    );
  }

  return (
    <>
      {/* Summary */}
      <div className="px-4 py-4 border-b border-border">
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <div className="text-[11px] tracking-[0.1em] uppercase text-txt-3 mb-1">claimable</div>
            <div className="font-display text-2xl font-bold text-mint leading-none">
              ${earnings.totalClaimable.toFixed(2)}
            </div>
          </div>
          <div>
            <div className="text-[11px] tracking-[0.1em] uppercase text-txt-3 mb-1">
              total earned
            </div>
            <div className="font-display text-2xl font-bold text-txt leading-none">
              ${earnings.totalEarned.toFixed(2)}
            </div>
          </div>
        </div>

        <button
          className={cn(
            'w-full py-3 rounded-[3px] border-0 font-mono text-[13px] font-bold tracking-[0.08em] uppercase cursor-pointer transition-all',
            earnings.totalClaimable > 0
              ? 'bg-mint text-bg shadow-[0_0_16px_rgba(77,232,180,0.2)] hover:bg-[#6ef0c2]'
              : 'bg-bg-2 text-txt-3 cursor-not-allowed',
            claiming && 'opacity-70 cursor-wait',
          )}
          onClick={() => claim()}
          disabled={earnings.totalClaimable <= 0 || claiming}
        >
          {claiming
            ? 'Claiming…'
            : earnings.totalClaimable > 0
              ? `Claim $${earnings.totalClaimable.toFixed(2)} USDC`
              : 'Nothing to claim'}
        </button>

        {claiming && (
          <div className="flex items-center justify-center gap-2 text-[11px] text-txt-3 mt-2">
            <div className="w-1.5 h-1.5 rounded-full bg-mint animate-livep" />
            Confirm in wallet…
          </div>
        )}

        <div className="flex items-center justify-between text-[11px] text-txt-3 mt-3 pt-2 border-t border-border">
          <span>previously claimed</span>
          <span className="text-txt-2">${earnings.totalClaimed.toFixed(2)}</span>
        </div>
      </div>

      {/* Created token list */}
      <div className="px-4 py-3">
        <div className="text-[10px] tracking-[0.14em] uppercase text-txt-3 mb-3">
          your tokens ({earnings.tokens.length})
        </div>

        <div className="flex flex-col gap-2">
          {earnings.tokens.map((t) => (
            <div
              key={t.address}
              className="bg-bg-2 border border-border rounded-[3px] p-3 cursor-pointer transition-all hover:border-border-2"
              onClick={() => onTokenClick(t.address)}
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">{t.emoji}</span>
                <div className="flex-1">
                  <div className="text-[13px] font-bold text-txt">{t.name}</div>
                  <div className="text-[11px] text-txt-3">{t.ltName}</div>
                </div>
                <div
                  className={cn(
                    'text-[10px] tracking-[0.08em] uppercase px-1.5 py-px rounded-sm border',
                    t.status === 'graduating' && 'text-amber border-amber/30',
                    t.status === 'graduated' && 'text-mint border-mint/30',
                    t.status === 'active' && 'text-txt-3 border-border',
                  )}
                >
                  {t.status}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 text-[12px]">
                <div>
                  <div className="text-txt-3 text-[10px] uppercase tracking-wider">volume</div>
                  <div className="text-txt font-semibold">{formatUsd(t.totalVolumeUsd)}</div>
                </div>
                <div>
                  <div className="text-txt-3 text-[10px] uppercase tracking-wider">earned</div>
                  <div className="text-txt font-semibold">${t.feesEarnedUsd.toFixed(2)}</div>
                </div>
                <div>
                  <div className="text-txt-3 text-[10px] uppercase tracking-wider">claimable</div>
                  <div className="text-mint font-semibold">${t.feesClaimableUsd.toFixed(2)}</div>
                </div>
              </div>

              {t.status !== 'graduated' && (
                <div className="mt-2">
                  <div className="h-[4px] bg-white/[0.07] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-mint-dim rounded-full"
                      style={{ width: `${t.curveFilled}%` }}
                    />
                  </div>
                  <div className="text-[10px] text-txt-3 mt-1">{t.curveFilled}% filled</div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Footer info */}
      <div className="px-4 py-3 border-t border-border mt-auto">
        <div className="text-[11px] text-txt-3 leading-[1.6]">
          <span className="text-mint font-semibold">0.1%</span> of all curve volume goes to token
          creators. Fees accrue in USDC and can be claimed anytime. Earnings stop when a token
          graduates.
        </div>
      </div>
    </>
  );
}
