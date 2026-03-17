import { useState, useEffect } from 'react';
import { cn } from '@/utils/format';
import { QUICK_AMOUNTS, FEES, SLIPPAGE_OPTIONS } from '@/config/constants';
import { useTradeRouter } from '@/hooks/useTradeRouter';
import { useWallet } from '@/hooks/useWallet';
import CreatorBadge from './CreatorBadge';
import type { Token } from '@/services/types';
import type { BuyQuote, SellQuote } from '@/services/tradeRouter';

interface Props {
  token: Token;
}

export default function TradePanel({ token }: Props) {
  const [mode, setMode] = useState<'buy' | 'sell'>('buy');
  const [amount, setAmount] = useState('');
  const [slippage, setSlippage] = useState(0.005);
  const [copied, setCopied] = useState(false);
  const [buyQuote, setBuyQuote] = useState<BuyQuote | null>(null);
  const [sellQuote, setSellQuote] = useState<SellQuote | null>(null);

  const { isConnected, connect } = useWallet();
  const { step, txHash, error, getQuoteBuy, getQuoteSell, executeBuy, executeSell, reset } =
    useTradeRouter();

  const amtNum = parseFloat(amount) || 0;

  useEffect(() => {
    if (amtNum <= 0) {
      setBuyQuote(null);
      setSellQuote(null);
      return;
    }
    if (mode === 'buy') {
      getQuoteBuy(token.address, amtNum).then(setBuyQuote);
    } else {
      const tokenAmount = amtNum / 0.000188;
      getQuoteSell(token.address, tokenAmount, 0.000188).then(setSellQuote);
    }
  }, [amtNum, mode, token.address, getQuoteBuy, getQuoteSell]);

  const doTrade = () => {
    if (!isConnected) {
      connect();
      return;
    }
    if (!amtNum) return;

    if (mode === 'buy') {
      executeBuy(token.address, amtNum, slippage);
    } else {
      const tokenAmount = amtNum / 0.000188;
      executeSell(token.address, tokenAmount, slippage);
    }
  };

  useEffect(() => {
    if (step === 'confirmed') {
      const t = setTimeout(() => {
        reset();
        setAmount('');
      }, 3000);
      return () => clearTimeout(t);
    }
  }, [step, reset]);

  const copyCA = () => {
    navigator.clipboard.writeText(token.address).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isBusy = step === 'approving' || step === 'executing';

  const buyFeeRow = mode === 'buy' && buyQuote
    ? `$${buyQuote.curveFee.toFixed(2)}`
    : '—';
  const sellFeeRow = mode === 'sell' && sellQuote
    ? `$${sellQuote.totalFee.toFixed(2)}`
    : '—';

  const estimateRows =
    mode === 'buy'
      ? [
          { label: 'tokens received', value: buyQuote?.youReceive ?? '—', hi: true },
          { label: 'price impact', value: buyQuote ? `${buyQuote.priceImpactPct}%` : '—', hi: false },
          { label: `fee (${(FEES.curveBuy * 100).toFixed(1)}%)`, value: buyFeeRow, hi: false },
          { label: 'you pay (USDC)', value: buyQuote ? `$${buyQuote.youPay.toFixed(2)}` : '—', hi: true },
        ]
      : [
          {
            label: 'you receive (USDC)',
            value: sellQuote ? `$${sellQuote.youReceive.toFixed(2)}` : '—',
            hi: true,
          },
          { label: 'price impact', value: sellQuote ? `${sellQuote.priceImpactPct}%` : '—', hi: false },
          {
            label: `curve fee (${(FEES.curveSell * 100).toFixed(1)}%)`,
            value: sellQuote ? `$${sellQuote.curveFee.toFixed(2)}` : '—',
            hi: false,
          },
          {
            label: `LT redemption (${(FEES.ltRedemption * 100).toFixed(1)}%)`,
            value: sellQuote ? `$${sellQuote.ltRedemptionFee.toFixed(2)}` : '—',
            hi: false,
          },
          { label: 'total fees', value: sellFeeRow, hi: false },
        ];

  const buttonLabel = () => {
    if (!isConnected) return 'CONNECT WALLET';
    if (step === 'approving') return 'APPROVING USDC…';
    if (step === 'executing') return mode === 'buy' ? 'BUYING…' : 'SELLING…';
    if (step === 'confirmed') return '✓ CONFIRMED';
    if (step === 'error') return 'RETRY';
    return `${mode === 'buy' ? 'BUY' : 'SELL'} ${token.name}`;
  };

  return (
    <div className="w-[300px] shrink-0 flex flex-col bg-bg-1">
      {/* Graduating banner */}
      {token.status === 'graduating' && (
        <div className="flex items-center justify-center gap-2 px-2 py-2 bg-mint/[0.07] border-b border-mint/30 text-[12px] font-semibold text-mint tracking-[0.06em] uppercase animate-gp2 shrink-0">
          <div className="w-1.5 h-1.5 rounded-full bg-mint" />
          graduating · {token.curveFilled}% filled
          <div className="w-1.5 h-1.5 rounded-full bg-mint" />
        </div>
      )}

      {/* BUY/SELL toggle */}
      <div className="grid grid-cols-2 shrink-0">
        <button
          className={cn(
            'h-10 flex items-center justify-center text-[13px] font-bold tracking-[0.08em] uppercase cursor-pointer border-0 bg-transparent font-mono text-txt-3 border-b-2 border-b-transparent transition-all',
            mode === 'buy' && 'text-mint bg-mint/[0.08] border-b-mint',
          )}
          onClick={() => { setMode('buy'); reset(); }}
        >
          BUY
        </button>
        <button
          className={cn(
            'h-10 flex items-center justify-center text-[13px] font-bold tracking-[0.08em] uppercase cursor-pointer border-0 bg-transparent font-mono text-txt-3 border-b-2 border-b-transparent transition-all',
            mode === 'sell' && 'text-red bg-red/[0.07] border-b-red',
          )}
          onClick={() => { setMode('sell'); reset(); }}
        >
          SELL
        </button>
      </div>

      {/* Trade form */}
      <div className="px-3 py-3 flex-1 overflow-y-auto flex flex-col gap-2.5">
        <div>
          <label className="text-[11px] tracking-[0.1em] uppercase text-txt-3 mb-1 block">
            amount (USDC)
          </label>
          <div className="flex items-center bg-bg-2 border border-border rounded-[3px] px-3 py-2 gap-2">
            <span className="text-[13px] text-txt-3">$</span>
            <input
              className="flex-1 bg-transparent border-0 outline-0 font-mono text-lg font-semibold text-txt placeholder:text-txt-4"
              type="number"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={isBusy}
            />
            <span
              className="text-[11px] text-mint cursor-pointer"
              onClick={() => setAmount('4210')}
            >
              MAX
            </span>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-[5px]">
          {QUICK_AMOUNTS.map((qa) => (
            <button
              key={qa}
              className="py-[5px] rounded-sm border border-border bg-bg-2 font-mono text-[12px] text-txt-3 cursor-pointer text-center transition-all hover:border-border-2 hover:text-txt"
              onClick={() => setAmount(String(qa))}
              disabled={isBusy}
            >
              ${qa >= 1000 ? `${qa / 1000}K` : qa}
            </button>
          ))}
        </div>

        {/* Estimate box — fee breakdown differs between buy and sell */}
        <div className="bg-bg-2 border border-border rounded-[3px] px-3 py-2.5">
          {estimateRows.map((r) => (
            <div key={r.label} className="flex justify-between text-[12px] mb-[5px] last:mb-0">
              <span className="text-txt-3">{r.label}</span>
              <span className={cn('font-medium', r.hi ? 'text-mint' : 'text-txt-2')}>
                {r.value}
              </span>
            </div>
          ))}
        </div>

        {/* Sell-specific: show that LT redemption is handled automatically */}
        {mode === 'sell' && amtNum > 0 && (
          <div className="text-[11px] text-txt-3 bg-bg-2 border border-border rounded-sm px-2.5 py-2 leading-[1.6]">
            LT redemption is handled atomically by the router — you receive USDC directly.
          </div>
        )}

        <div className="flex items-center gap-[5px]">
          <span className="text-[11px] text-txt-3 tracking-[0.06em] mr-[2px]">slippage</span>
          {SLIPPAGE_OPTIONS.map((sl) => (
            <button
              key={sl}
              className={cn(
                'py-[3px] px-2 rounded-sm border font-mono text-[12px] cursor-pointer',
                slippage === sl
                  ? 'border-mint text-mint'
                  : 'border-border text-txt-3 bg-transparent',
              )}
              onClick={() => setSlippage(sl)}
              disabled={isBusy}
            >
              {sl * 100}%
            </button>
          ))}
        </div>

        {error && (
          <div className="text-[12px] text-red bg-red/10 border border-red/20 rounded-sm px-2.5 py-1.5">
            {error}
          </div>
        )}

        {step === 'confirmed' && txHash && (
          <div className="text-[12px] text-mint bg-mint/10 border border-mint/20 rounded-sm px-2.5 py-1.5">
            ✓ Transaction confirmed
          </div>
        )}

        <button
          className={cn(
            'w-full py-3.5 rounded-[3px] border-0 font-mono text-sm font-bold tracking-[0.08em] uppercase cursor-pointer transition-all',
            step === 'confirmed'
              ? 'bg-mint/20 text-mint cursor-default'
              : mode === 'buy'
                ? 'bg-mint text-bg shadow-[0_0_20px_rgba(77,232,180,0.2)] hover:bg-[#6ef0c2]'
                : 'bg-red text-white hover:bg-red/90',
            isBusy && 'opacity-70 cursor-wait',
          )}
          onClick={doTrade}
          disabled={isBusy || step === 'confirmed'}
        >
          {buttonLabel()}
        </button>

        {/* Tx flow indicator */}
        {isBusy && (
          <div className="flex items-center gap-2 text-[11px] text-txt-3">
            <div className="w-1.5 h-1.5 rounded-full bg-mint animate-livep" />
            {step === 'approving'
              ? 'Waiting for USDC approval in wallet…'
              : 'Confirm transaction in wallet…'}
          </div>
        )}
      </div>

      {/* Creator earnings badge */}
      <CreatorBadge token={token} />

      {/* Token info footer */}
      <div className="border-t border-border px-3 py-3 shrink-0">
        {[
          {
            label: 'contract',
            value: (
              <a className="text-mint no-underline cursor-pointer" onClick={copyCA}>
                {copied
                  ? '✓ copied'
                  : `${token.address.slice(0, 6)}…${token.address.slice(-4)} ⎘`}
              </a>
            ),
          },
          { label: 'supply', value: '1,000,000,000' },
          {
            label: 'pair',
            value: <span className="text-mint">{token.ltName}</span>,
          },
          {
            label: 'status',
            value: (
              <span className={token.status === 'graduating' ? 'text-amber' : 'text-txt-2'}>
                {token.status}
                {token.status === 'graduating' && ' ⚡'}
              </span>
            ),
          },
          {
            label: 'settlement',
            value: <span className="text-txt-2">USDC (atomic)</span>,
          },
        ].map((r) => (
          <div key={r.label} className="flex justify-between text-[12px] mb-1.5 last:mb-0">
            <span className="text-txt-3">{r.label}</span>
            <span className="text-txt-2">{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
