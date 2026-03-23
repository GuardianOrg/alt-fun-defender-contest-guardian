import { useState } from 'react';
import PairSelector from './PairSelector';
import TokenForm from './TokenForm';
import SeedBuy from './SeedBuy';
import LivePreview from './LivePreview';
import { useWallet } from '@/hooks/useWallet';
import { cn } from '@/utils/format';
import type { Direction } from '@/services/types';
import type { UnderlyingAsset, Leverage } from '@/config/constants';
import styles from './CreateView.module.css';

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
    <div className={styles.layout}>
      <div className={styles.formColumn}>
        <div className={styles.pageHeader}>
          <div className={styles.eyebrow}>new token</div>
          <div className={styles.heading}>
            Create a levered token
          </div>
          <div className={styles.subheading}>
            Choose a direction, pick your underlying, set your leverage, and deploy to the bonding curve in one transaction.
          </div>
        </div>

        <div className={styles.steps}>
          <PairSelector
            direction={direction}
            asset={asset}
            leverage={leverage}
            onDirectionChange={setDirection}
            onAssetChange={setAsset}
            onLeverageChange={setLeverage}
          />

          <div className={styles.divider} />

          <TokenForm
            name={name}
            ticker={ticker}
            onNameChange={setName}
            onTickerChange={setTicker}
            onImageChange={(_, preview) => setImagePreview(preview)}
          />

          <div className={styles.divider} />

          <SeedBuy seedAmount={seedAmount} onSeedChange={setSeedAmount} />

          <div className={styles.ctaArea}>
            {launchError && (
              <div className={styles.errorBanner}>
                <span className={styles.errorIcon}>⚠</span>
                {launchError}
              </div>
            )}

            {launchStep === 'confirmed' && (
              <div className={styles.successBanner}>
                <span>✓</span>
                Token deployed! Curve is live.
              </div>
            )}

            <button
              className={cn(
                styles.launchButton,
                launchStep === 'confirmed'
                  ? styles.launchButtonConfirmed
                  : styles.launchButtonActive,
                isBusy && styles.launchButtonBusy,
              )}
              onClick={handleSubmit}
              disabled={isBusy || launchStep === 'confirmed'}
            >
              {buttonLabel()}
            </button>

            {isBusy && (
              <div className={styles.busyRow}>
                <div className={styles.busyDot} />
                {launchStep === 'approving'
                  ? 'Approve USDC spend in your wallet…'
                  : 'Confirm deployment in your wallet…'}
              </div>
            )}

            {launchStep === 'idle' && (
              <div className={styles.idleHint}>
                {seedAmt > 0
                  ? `You will approve $${seedAmt.toFixed(2)} USDC, then confirm deployment`
                  : 'You will be asked to confirm in your wallet'}
              </div>
            )}

            {seedAmt > 0 && launchStep === 'idle' && (
              <div className={styles.seedInfo}>
                Seed buy of <span className={styles.mintHighlight}>${seedAmt.toFixed(2)} USDC</span>{' '}
                is routed atomically through the TX Router — you receive tokens directly.
              </div>
            )}
          </div>
        </div>
      </div>

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
