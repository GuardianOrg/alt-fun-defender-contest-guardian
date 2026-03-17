import { useState } from 'react';
import PairSelector from './PairSelector';
import TokenForm from './TokenForm';
import SeedBuy from './SeedBuy';
import LivePreview from './LivePreview';
import { useWallet } from '@/hooks/useWallet';
import { cn } from '@/utils/format';
import type { Direction } from '@/services/types';
import type { UnderlyingAsset, Leverage } from '@/config/constants';

type LaunchStep = 'idle' | 'approving' | 'deploying' | 'confirmed' | 'error';

export default function CreateView() {
  const [direction, setDirection] = useState<Direction>('long');
  const [asset, setAsset] = useState<UnderlyingAsset>('HYPE');
  const [leverage, setLeverage] = useState<Leverage>(2);
  const [name, setName] = useState('');
  const [ticker, setTicker] = useState('');
  const [seedAmount, setSeedAmount] = useState('');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [launchStep, setLaunchStep] = useState<LaunchStep>('idle');
  const [launchError, setLaunchError] = useState<string | null>(null);

  const { isConnected, connect } = useWallet();
  const ltName = `${asset} ${leverage}× ${direction === 'long' ? 'Long' : 'Short'}`;
  const seedAmt = parseFloat(seedAmount) || 0;
  const isBusy = launchStep === 'approving' || launchStep === 'deploying';

  const handleSubmit = async () => {
    if (!isConnected) {
      connect();
      return;
    }
    if (!name.trim() || !ticker.trim()) {
      setLaunchError('Please enter a token name and ticker.');
      return;
    }

    try {
      setLaunchError(null);

      if (seedAmt > 0) {
        setLaunchStep('approving');
        await new Promise((r) => setTimeout(r, 500));
      }

      setLaunchStep('deploying');
      await new Promise((r) => setTimeout(r, 1500));

      setLaunchStep('confirmed');
    } catch (e) {
      setLaunchError(e instanceof Error ? e.message : 'Launch failed');
      setLaunchStep('error');
    }
  };

  const buttonLabel = () => {
    if (!isConnected) return 'CONNECT WALLET TO LAUNCH';
    if (launchStep === 'approving') return 'APPROVING USDC…';
    if (launchStep === 'deploying') return 'DEPLOYING…';
    if (launchStep === 'confirmed') return '✓ TOKEN LAUNCHED';
    if (launchStep === 'error') return '⚡ RETRY LAUNCH';
    return '⚡ LAUNCH TOKEN';
  };

  return (
    <div className="grid grid-cols-[1fr_360px] flex-1 overflow-hidden">
      {/* Form column */}
      <div className="px-10 py-8 border-r border-border overflow-y-auto">
        <div className="mb-7 pb-5 border-b border-border">
          <div className="text-[10px] tracking-[0.14em] uppercase text-mint mb-1 font-medium">new token</div>
          <div className="font-display text-xl font-semibold text-txt tracking-[0.03em] mb-1">
            Create a levered memecoin
          </div>
          <div className="text-[12px] text-txt-3">
            Choose a direction, pick your underlying, deploy.
          </div>
        </div>

        <PairSelector
          direction={direction}
          asset={asset}
          leverage={leverage}
          onDirectionChange={setDirection}
          onAssetChange={setAsset}
          onLeverageChange={setLeverage}
        />

        <div className="h-px bg-border my-7" />

        <TokenForm
          name={name}
          ticker={ticker}
          onNameChange={setName}
          onTickerChange={setTicker}
          onImageChange={(_, preview) => setImagePreview(preview)}
        />

        <div className="h-px bg-border my-7" />

        <SeedBuy seedAmount={seedAmount} onSeedChange={setSeedAmount} />

        {launchError && (
          <div className="text-[12px] text-red bg-red/[0.06] border border-red/20 rounded-sm px-2.5 py-1.5 mt-4">
            {launchError}
          </div>
        )}

        {launchStep === 'confirmed' && (
          <div className="text-[12px] text-mint bg-mint/[0.06] border border-mint/20 rounded-sm px-2.5 py-1.5 mt-4">
            ✓ Token deployed! Curve is live.
          </div>
        )}

        <button
          className={cn(
            'w-full py-3.5 rounded-[3px] cursor-pointer border-0 font-mono text-[12px] font-bold tracking-[0.08em] uppercase mt-6 transition-all',
            launchStep === 'confirmed'
              ? 'bg-mint/15 text-mint cursor-default'
              : 'bg-mint text-bg shadow-mint-glow-lg hover:bg-mint-hover',
            isBusy && 'opacity-70 cursor-wait',
          )}
          onClick={handleSubmit}
          disabled={isBusy || launchStep === 'confirmed'}
        >
          {buttonLabel()}
        </button>

        {isBusy && (
          <div className="flex items-center justify-center gap-2 text-[10px] text-txt-3 mt-2.5">
            <div className="w-1.5 h-1.5 rounded-full bg-mint animate-livep" />
            {launchStep === 'approving'
              ? 'Approve USDC spend in your wallet…'
              : 'Confirm deployment in your wallet…'}
          </div>
        )}

        {launchStep === 'idle' && (
          <div className="text-[12px] text-txt-3 text-center mt-2.5">
            {seedAmt > 0
              ? `You will approve $${seedAmt.toFixed(2)} USDC, then confirm deployment`
              : 'You will be asked to confirm in your wallet'}
          </div>
        )}

        {seedAmt > 0 && launchStep === 'idle' && (
          <div className="text-[10px] text-txt-3 bg-bg-2/40 border border-border rounded-sm px-2.5 py-2 mt-3 leading-relaxed text-center">
            Seed buy of <span className="text-mint font-semibold">${seedAmt.toFixed(2)} USDC</span>{' '}
            is routed atomically through the TX Router — you receive tokens directly.
          </div>
        )}
      </div>

      {/* Preview column */}
      <LivePreview
        name={name}
        ticker={ticker}
        direction={direction}
        asset={asset}
        leverage={leverage}
        imagePreview={imagePreview}
      />
    </div>
  );
}
