import { useState, useEffect, useRef } from 'react';
import { cn } from '@/utils/format';
import { useTradeRouter } from '@/hooks/useTradeRouter';
import { useWallet } from '@/hooks/useWallet';
import CreatorBadge from './CreatorBadge';
import type { Token } from '@/services/types';

interface Props {
  token: Token;
}

function SettingsPopup({
  slippage,
  onSlippageChange,
  onClose,
}: {
  slippage: number;
  onSlippageChange: (v: number) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [custom, setCustom] = useState(String(slippage * 100));

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const presets = [0.5, 1, 2, 5];

  const applyCustom = (val: string) => {
    setCustom(val);
    const n = parseFloat(val);
    if (!isNaN(n) && n > 0 && n <= 50) {
      onSlippageChange(n / 100);
    }
  };

  return (
    <div
      ref={ref}
      className="absolute top-full right-0 mt-1.5 w-[260px] bg-bg-2 border border-border-2 rounded-xl shadow-panel z-50 p-4 space-y-4"
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-txt">Settings</span>
        <button
          className="text-txt-3 hover:text-txt text-[13px] cursor-pointer bg-transparent border-0 font-mono"
          onClick={onClose}
        >
          [Close]
        </button>
      </div>

      <div>
        <div className="text-[11px] tracking-[0.08em] uppercase text-txt-3 mb-2 font-medium">
          Max slippage (%)
        </div>
        <div className="flex items-center bg-bg-3/60 border border-border rounded-lg px-3.5 py-2.5 mb-2.5 transition-all focus-within:border-border-2">
          <input
            className="flex-1 bg-transparent border-0 outline-0 font-mono text-base font-semibold text-txt placeholder:text-txt-4 tabular-nums"
            type="number"
            value={custom}
            onChange={(e) => applyCustom(e.target.value)}
            min="0.1"
            max="50"
            step="0.1"
          />
          <span className="text-[13px] text-txt-3 ml-1">%</span>
        </div>
        <div className="text-[11px] text-txt-4 leading-relaxed mb-3">
          Maximum price change you&apos;re willing to accept when placing trades.
        </div>
        <div className="flex gap-1.5">
          {presets.map((p) => (
            <button
              key={p}
              className={cn(
                'flex-1 py-1.5 rounded-lg border font-mono text-[13px] cursor-pointer text-center transition-all duration-150',
                slippage === p / 100
                  ? 'border-mint/40 text-mint bg-mint/[0.08]'
                  : 'border-border text-txt-3 bg-transparent hover:border-border-2 hover:text-txt',
              )}
              onClick={() => {
                onSlippageChange(p / 100);
                setCustom(String(p));
              }}
            >
              {p}%
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const QUICK_USDC = [100, 500, 1000] as const;

export default function TradePanel({ token }: Props) {
  const [mode, setMode] = useState<'buy' | 'sell'>('buy');
  const [amount, setAmount] = useState('');
  const [denomUsdc, setDenomUsdc] = useState(true);
  const [slippage, setSlippage] = useState(0.02);
  const [copied, setCopied] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const { isConnected, connect } = useWallet();
  const { step, txHash, error, executeBuy, executeSell, reset } = useTradeRouter();

  const amtNum = parseFloat(amount) || 0;

  const mockPrice = 0.000188;
  const usdcIn = denomUsdc ? amtNum : amtNum * mockPrice;
  const estimateTokens = usdcIn / mockPrice;
  const tokensIn = denomUsdc ? amtNum / mockPrice : amtNum;
  const estimateUsdc = tokensIn * mockPrice * 0.985;

  const doTrade = () => {
    if (!isConnected) {
      connect();
      return;
    }
    if (!amtNum) return;

    if (mode === 'buy') {
      const usdcAmt = denomUsdc ? amtNum : amtNum * 0.000188;
      executeBuy(token.address, usdcAmt, slippage);
    } else {
      const tokenAmount = denomUsdc ? amtNum / 0.000188 : amtNum;
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

  const buttonLabel = () => {
    if (!isConnected) return 'CONNECT WALLET';
    if (step === 'approving') return 'APPROVING USDC…';
    if (step === 'executing') return mode === 'buy' ? 'BUYING…' : 'SELLING…';
    if (step === 'confirmed') return '✓ CONFIRMED';
    if (step === 'error') return 'RETRY';
    return `${mode === 'buy' ? 'BUY' : 'SELL'} ${token.name}`;
  };

  const ticker = token.name.split(' ')[0].toUpperCase();

  return (
    <div className="w-[300px] shrink-0 flex flex-col bg-bg-1 shadow-panel">
      {/* Graduating banner */}
      {token.status === 'graduating' && (
        <div className="flex items-center justify-center gap-2 px-2 py-2 bg-mint/[0.06] border-b border-mint/20 text-[11px] font-semibold text-mint tracking-[0.08em] uppercase animate-gp2 shrink-0">
          <div className="w-1.5 h-1.5 rounded-full bg-mint" />
          graduating · {token.curveFilled}% filled
          <div className="w-1.5 h-1.5 rounded-full bg-mint" />
        </div>
      )}

      {/* BUY/SELL toggle + settings gear */}
      <div className="flex items-center shrink-0 border-b border-border">
        <div className="grid grid-cols-2 flex-1">
          <button
            className={cn(
              'relative h-10 flex items-center justify-center text-[13px] font-bold tracking-[0.08em] uppercase cursor-pointer border-0 bg-transparent font-mono transition-all duration-150',
              mode === 'buy'
                ? 'text-mint bg-mint/[0.06]'
                : 'text-txt-3 hover:text-txt hover:bg-white/[0.02]',
            )}
            onClick={() => { setMode('buy'); reset(); }}
          >
            BUY
            {mode === 'buy' && <span className="absolute bottom-0 inset-x-2 h-[2px] bg-mint rounded-full" />}
          </button>
          <button
            className={cn(
              'relative h-10 flex items-center justify-center text-[13px] font-bold tracking-[0.08em] uppercase cursor-pointer border-0 bg-transparent font-mono transition-all duration-150',
              mode === 'sell'
                ? 'text-red bg-red/[0.05]'
                : 'text-txt-3 hover:text-txt hover:bg-white/[0.02]',
            )}
            onClick={() => { setMode('sell'); reset(); }}
          >
            SELL
            {mode === 'sell' && <span className="absolute bottom-0 inset-x-2 h-[2px] bg-red rounded-full" />}
          </button>
        </div>

        {/* Settings gear */}
        <div className="relative shrink-0 px-2 h-10 flex items-center">
          <button
            className={cn(
              'w-7 h-7 flex items-center justify-center rounded-lg cursor-pointer border-0 transition-all duration-150',
              settingsOpen
                ? 'bg-mint/[0.10] text-mint'
                : 'bg-transparent text-txt-3 hover:text-txt hover:bg-white/[0.04]',
            )}
            onClick={() => setSettingsOpen(!settingsOpen)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
            </svg>
          </button>

          {settingsOpen && (
            <SettingsPopup
              slippage={slippage}
              onSlippageChange={setSlippage}
              onClose={() => setSettingsOpen(false)}
            />
          )}
        </div>
      </div>

      {/* Trade form */}
      <div className="px-3.5 py-4 flex-1 overflow-y-auto flex flex-col gap-3">
        {/* Denomination toggle */}
        <button
          className="self-start text-[11px] text-txt-3 hover:text-mint cursor-pointer bg-transparent border-0 font-mono transition-colors"
          onClick={() => { setDenomUsdc(!denomUsdc); setAmount(''); }}
        >
          Switch to {denomUsdc ? ticker : 'USDC'}
        </button>

        {/* Amount input */}
        <div className="flex items-center bg-bg-2/60 border border-border rounded-xl px-4 py-3 gap-2 transition-all focus-within:border-border-2 focus-within:bg-bg-2">
          <input
            className="flex-1 bg-transparent border-0 outline-0 font-mono text-xl font-semibold text-txt placeholder:text-txt-4 tabular-nums min-w-0"
            type="number"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={isBusy}
          />
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-[13px] font-semibold text-txt-2">
              {denomUsdc ? 'USDC' : ticker}
            </span>
            <div className={cn(
              'w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold',
              denomUsdc
                ? 'bg-[#2775ca] text-white'
                : mode === 'buy' ? 'bg-mint/20 text-mint' : 'bg-red/20 text-red',
            )}>
              {denomUsdc ? '$' : token.image ? (
                <img src={token.image} alt="" className="w-full h-full rounded-full object-cover" />
              ) : token.emoji}
            </div>
          </div>
        </div>

        {/* Quick amounts: Reset + presets + Max */}
        <div className="flex gap-1.5">
          <button
            className="px-2.5 py-1.5 rounded-lg border border-border text-txt-3 font-mono text-[13px] cursor-pointer transition-all duration-150 hover:border-border-2 hover:text-txt bg-transparent"
            onClick={() => setAmount('')}
            disabled={isBusy}
          >
            Reset
          </button>
          {QUICK_USDC.map((qa) => (
            <button
              key={qa}
              className={cn(
                'flex-1 py-1.5 rounded-lg border font-mono text-[13px] cursor-pointer text-center transition-all duration-150',
                amount === String(qa)
                  ? 'border-mint/40 text-mint bg-mint/[0.06]'
                  : 'border-border text-txt-3 bg-transparent hover:border-border-2 hover:text-txt',
              )}
              onClick={() => { setDenomUsdc(true); setAmount(String(qa)); }}
              disabled={isBusy}
            >
              {qa >= 1000 ? `${qa / 1000}K` : qa}
            </button>
          ))}
          <button
            className="px-2.5 py-1.5 rounded-lg border border-border text-mint font-mono text-[11px] font-bold tracking-[0.04em] cursor-pointer transition-all duration-150 hover:border-mint/40 hover:bg-mint/[0.04] bg-transparent"
            onClick={() => { setDenomUsdc(true); setAmount('4210'); }}
            disabled={isBusy}
          >
            Max
          </button>
        </div>

        {/* Estimate */}
        {amtNum > 0 && (
          <div className="text-[13px] text-txt-2 tabular-nums">
            {mode === 'buy' ? (
              <>
                ≈ you receive{' '}
                <span className="text-txt font-semibold">
                  {estimateTokens.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </span>{' '}
                <span className="text-mint/70">{ticker}</span>
              </>
            ) : (
              <>
                ≈ you receive{' '}
                <span className="text-txt font-semibold">
                  ${estimateUsdc.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>{' '}
                <span className="text-txt-3">USDC</span>
              </>
            )}
          </div>
        )}

        {/* Error / confirmation */}
        {error && (
          <div className="text-[13px] text-red bg-red/[0.06] border border-red/20 rounded-lg px-3 py-2 flex items-center gap-2">
            <span className="text-red/60">⚠</span>
            {error}
          </div>
        )}

        {step === 'confirmed' && txHash && (
          <div className="text-[13px] text-mint bg-mint/[0.06] border border-mint/20 rounded-lg px-3 py-2 flex items-center gap-2">
            ✓ Transaction confirmed
          </div>
        )}

        {/* CTA */}
        <button
          className={cn(
            'w-full py-3 rounded-xl border-0 font-mono text-[13px] font-bold tracking-[0.08em] uppercase cursor-pointer transition-all duration-200',
            step === 'confirmed'
              ? 'bg-mint/15 text-mint cursor-default'
              : mode === 'buy'
                ? 'bg-mint text-bg shadow-mint-glow hover:bg-mint-hover'
                : 'bg-red text-white shadow-red-glow hover:bg-red/90',
            isBusy && 'opacity-70 cursor-wait',
          )}
          onClick={doTrade}
          disabled={isBusy || step === 'confirmed'}
        >
          {buttonLabel()}
        </button>

        {isBusy && (
          <div className="flex items-center gap-2 text-[11px] text-txt-3">
            <div className="w-1.5 h-1.5 rounded-full bg-mint animate-livep" />
            {step === 'approving'
              ? 'Waiting for USDC approval in wallet…'
              : 'Confirm transaction in wallet…'}
          </div>
        )}
      </div>

      <CreatorBadge token={token} />

      {/* Compact footer */}
      <div className="border-t border-border px-3.5 py-2.5 shrink-0 flex items-center justify-between text-[11px]">
        <div className="flex items-center gap-2">
          <a
            className="text-mint/70 no-underline cursor-pointer hover:text-mint transition-colors font-mono"
            onClick={copyCA}
          >
            {copied ? '✓ copied' : `${token.address.slice(0, 6)}…${token.address.slice(-4)}`}
          </a>
          <span className="text-txt-4">·</span>
          <span className="text-txt-3">{token.ltName}</span>
        </div>
        <span className={cn(
          'font-medium',
          token.status === 'graduating' ? 'text-amber' : 'text-txt-4',
        )}>
          {token.status}{token.status === 'graduating' ? ' ⚡' : ''}
        </span>
      </div>
    </div>
  );
}
