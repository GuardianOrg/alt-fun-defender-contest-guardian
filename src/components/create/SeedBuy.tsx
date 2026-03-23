import { useState } from 'react';
import { cn } from '@/utils/format';
import { SEED_PCT_OPTIONS, GRADUATION_THRESHOLD_USD, TOKEN_SUPPLY } from '@/config/constants';
import StepHeader from './StepHeader';
import styles from './SeedBuy.module.css';

interface Props {
  seedAmount: string;
  onSeedChange: (v: string) => void;
}

export default function SeedBuy({ seedAmount, onSeedChange }: Props) {
  const [activePct, setActivePct] = useState<number | null>(null);
  const amt = parseFloat(seedAmount) || 0;

  const supplyPct = amt > 0 ? Math.min((amt / GRADUATION_THRESHOLD_USD) * 75, 99) : 0;
  const tokensReceived = amt > 0 ? `${((TOKEN_SUPPLY * supplyPct) / 100 / 1e6).toFixed(1)}M` : '—';
  const supplyStr = amt > 0 ? `${supplyPct.toFixed(1)}%` : '—';
  const curveStr = amt > 0 ? `${((amt / GRADUATION_THRESHOLD_USD) * 100).toFixed(1)}%` : '—';

  return (
    <div>
      <StepHeader
        step={3}
        title="Seed buy"
        subtitle="Buy tokens before anyone else. Sets the opening price."
      />

      <div className={styles.card}>
        <div className={styles.amountRow}>
          <span className={styles.dollarSign}>$</span>
          <input
            type="number"
            className={styles.amountInput}
            placeholder="0.00"
            value={seedAmount}
            onChange={(e) => {
              onSeedChange(e.target.value);
              setActivePct(null);
            }}
            min="0"
          />
        </div>

        <div className={styles.quickGrid}>
          {SEED_PCT_OPTIONS.map((opt) => (
            <button
              key={opt.pct}
              className={cn(
                styles.quickButton,
                activePct === opt.pct
                  ? styles.quickButtonActive
                  : styles.quickButtonInactive,
              )}
              onClick={() => {
                onSeedChange(String(opt.usd));
                setActivePct(opt.pct);
              }}
            >
              <div className={styles.quickLabel}>{opt.pct}%</div>
              <div className={styles.quickSub}>${opt.usd.toLocaleString()}</div>
            </button>
          ))}
        </div>

        <div className={styles.statsGrid}>
          {[
            { label: 'tokens received', value: tokensReceived, cls: '' },
            { label: '% of supply', value: supplyStr, cls: styles.textMint },
            { label: 'curve filled', value: curveStr, cls: '' },
          ].map((s) => (
            <div key={s.label} className={styles.statCard}>
              <div className={styles.statLabel}>{s.label}</div>
              <div className={cn(styles.statValue, s.cls)}>
                {s.value}
              </div>
            </div>
          ))}
        </div>
      </div>

      {amt <= 0 && (
        <div className={styles.skipHint}>
          Skip this step to launch with zero initial buy
        </div>
      )}
    </div>
  );
}
