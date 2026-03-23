import { useState } from 'react';
import { cn } from '@/utils/format';
import { SEED_PCT_OPTIONS, GRADUATION_THRESHOLD_USD, TOKEN_SUPPLY } from '@/config/constants';
import StepHeader from './StepHeader';

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

      <div className="bg-bg-2/40 border border-border rounded-xl p-5">
        {/* Amount input */}
        <div className="flex items-center gap-2 mb-4">
          <span className="text-lg font-semibold text-txt-3 shrink-0">$</span>
          <input
            type="number"
            className="flex-1 text-2xl font-semibold py-2 bg-transparent border-0 border-b-2 border-border outline-0 font-mono text-txt placeholder:text-txt-4 transition-colors focus:border-b-mint tabular-nums"
            placeholder="0.00"
            value={seedAmount}
            onChange={(e) => {
              onSeedChange(e.target.value);
              setActivePct(null);
            }}
            min="0"
          />
        </div>

        {/* Quick amounts */}
        <div className="grid grid-cols-5 gap-2 mb-4">
          {SEED_PCT_OPTIONS.map((opt) => (
            <button
              key={opt.pct}
              className={cn(
                'py-2.5 px-1 rounded-lg cursor-pointer text-center border font-mono transition-all duration-150',
                activePct === opt.pct
                  ? 'border-mint/40 bg-mint/[0.08] shadow-inner-mint'
                  : 'border-border bg-bg-3/50 hover:border-border-2 hover:bg-bg-3',
              )}
              onClick={() => {
                onSeedChange(String(opt.usd));
                setActivePct(opt.pct);
              }}
            >
              <div className="text-[13px] font-semibold text-txt">{opt.pct}%</div>
              <div className="text-[11px] text-txt-3 mt-[2px] tabular-nums">${opt.usd.toLocaleString()}</div>
            </button>
          ))}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: 'tokens received', value: tokensReceived, cls: '' },
            { label: '% of supply', value: supplyStr, cls: 'text-mint' },
            { label: 'curve filled', value: curveStr, cls: '' },
          ].map((s) => (
            <div key={s.label} className="bg-bg-3/40 border border-border rounded-lg px-3 py-2.5">
              <div className="text-[11px] text-txt-3 tracking-[0.06em]">{s.label}</div>
              <div className={cn('text-sm font-semibold text-txt mt-1 tabular-nums', s.cls)}>
                {s.value}
              </div>
            </div>
          ))}
        </div>
      </div>

      {amt <= 0 && (
        <div className="text-[11px] text-txt-4 mt-2 text-center">
          Skip this step to launch with zero initial buy
        </div>
      )}
    </div>
  );
}
