import { useState } from 'react';
import { useCreatorEarnings } from '@/hooks/useCreatorEarnings';
import { useWallet } from '@/hooks/useWallet';
import { cn } from '@/utils/format';
import type { Token } from '@/services/types';

interface Props {
  token: Token;
}

export default function CreatorBadge({ token }: Props) {
  const { address } = useWallet();
  const { earnings, claiming, claim } = useCreatorEarnings();
  const [expanded, setExpanded] = useState(false);

  const isCreator = !!address && token.creatorAddress.toLowerCase() === address.toLowerCase();
  if (!isCreator) return null;

  const tokenData = earnings?.tokens.find(
    (t) => t.address.toLowerCase() === token.address.toLowerCase(),
  );

  return (
    <div className="border-t border-mint/20 bg-mint/[0.04]">
      <button
        className="w-full flex items-center justify-between px-3 py-2.5 bg-transparent border-0 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <span className="text-[10px] tracking-[0.14em] uppercase text-mint font-semibold border border-mint/30 px-1.5 py-px rounded-sm">
            creator
          </span>
          <span className="text-[12px] text-mint font-semibold">
            {tokenData
              ? `$${tokenData.feesClaimableUsd.toFixed(2)} claimable`
              : 'Your token'}
          </span>
        </div>
        <span className="text-[12px] text-txt-3">{expanded ? '▴' : '▾'}</span>
      </button>

      {expanded && tokenData && (
        <div className="px-3 pb-3 flex flex-col gap-2">
          <div className="grid grid-cols-3 gap-2 text-[12px]">
            <div>
              <div className="text-txt-3 text-[10px] uppercase tracking-wider">volume</div>
              <div className="text-txt font-semibold">
                ${tokenData.totalVolumeUsd.toLocaleString()}
              </div>
            </div>
            <div>
              <div className="text-txt-3 text-[10px] uppercase tracking-wider">earned</div>
              <div className="text-txt font-semibold">
                ${tokenData.feesEarnedUsd.toFixed(2)}
              </div>
            </div>
            <div>
              <div className="text-txt-3 text-[10px] uppercase tracking-wider">claimable</div>
              <div className="text-mint font-semibold">
                ${tokenData.feesClaimableUsd.toFixed(2)}
              </div>
            </div>
          </div>

          <button
            className={cn(
              'w-full py-2 rounded-sm border-0 font-mono text-[12px] font-bold tracking-[0.08em] uppercase cursor-pointer transition-all',
              tokenData.feesClaimableUsd > 0
                ? 'bg-mint text-bg hover:bg-[#6ef0c2]'
                : 'bg-bg-2 text-txt-3 cursor-not-allowed',
              claiming && 'opacity-70 cursor-wait',
            )}
            disabled={tokenData.feesClaimableUsd <= 0 || claiming}
            onClick={() => claim(token.address)}
          >
            {claiming
              ? 'Claiming…'
              : tokenData.feesClaimableUsd > 0
                ? `Claim $${tokenData.feesClaimableUsd.toFixed(2)}`
                : 'Nothing to claim'}
          </button>

          <div className="text-[10px] text-txt-3 leading-[1.5]">
            You earn 0.1% of all volume on this curve. Fees settle in USDC.
          </div>
        </div>
      )}
    </div>
  );
}
