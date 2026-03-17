import { useState } from 'react';
import { cn } from '@/utils/format';
import { SEED_PCT_OPTIONS, GRADUATION_THRESHOLD_USD, TOKEN_SUPPLY } from '@/config/constants';

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
      <div className="text-[10px] tracking-[0.14em] uppercase text-mint mb-1 font-medium">step 3</div>
      <div className="font-display text-xl font-semibold text-txt tracking-[0.03em] mb-1">
        Seed buy{' '}
        <span className="text-sm font-normal text-txt-3">(optional)</span>
      </div>
      <div className="text-[12px] text-txt-3 mb-4">
        Buy tokens before anyone else. Sets the opening price.
      </div>

      <div className="bg-bg-2 border border-border rounded-[3px] p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-sm font-semibold text-txt-3 shrink-0">$</span>
          <input
            type="number"
            className="flex-1 text-[22px] font-semibold py-2 bg-transparent border-0 border-b border-border outline-0 font-mono text-txt placeholder:text-txt-4 focus:border-b-mint"
            placeholder="0.00"
            value={seedAmount}
            onChange={(e) => {
              onSeedChange(e.target.value);
              setActivePct(null);
            }}
            min="0"
          />
        </div>

        <div className="grid grid-cols-5 gap-1.5 mb-3.5">
          {SEED_PCT_OPTIONS.map((opt) => (
            <button
              key={opt.pct}
              className={cn(
                'py-2 px-1 rounded-[3px] cursor-pointer text-center border font-mono transition-all',
                activePct === opt.pct
                  ? 'border-mint bg-mint-bg'
                  : 'border-border bg-bg-3 hover:border-border-2',
              )}
              onClick={() => {
                onSeedChange(String(opt.usd));
                setActivePct(opt.pct);
              }}
            >
              <div className="text-[12px] font-semibold text-txt">{opt.pct}%</div>
              <div className="text-[10px] text-txt-3 mt-[2px]">${opt.usd.toLocaleString()}</div>
            </button>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-2">
          {[
            { label: 'tokens received', value: tokensReceived, cls: '' },
            { label: '% of supply', value: supplyStr, cls: 'text-mint' },
            { label: 'curve filled', value: curveStr, cls: '' },
          ].map((s) => (
            <div key={s.label} className="bg-bg-3 rounded-[3px] px-2.5 py-2">
              <div className="text-[10px] text-txt-3 tracking-[0.04em]">{s.label}</div>
              <div className={cn('text-sm font-semibold text-txt mt-[3px]', s.cls)}>
                {s.value}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
