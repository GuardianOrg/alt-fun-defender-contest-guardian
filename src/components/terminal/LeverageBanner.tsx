import { useState } from 'react';

const STORAGE_KEY = 'bf_lev_banner_v2';

export default function LeverageBanner() {
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem(STORAGE_KEY) === '1');

  if (dismissed) return null;

  const dismiss = () => {
    sessionStorage.setItem(STORAGE_KEY, '1');
    setDismissed(true);
  };

  return (
    <div className="shrink-0 flex items-center gap-3 px-4 py-2 bg-gradient-to-r from-mint/[0.08] via-bg-1 to-amber/[0.06] border-b border-mint/15">
      <span className="text-lg leading-none">⚡</span>
      <div className="flex-1 text-[13px] text-txt-2">
        Every token is backed by a{' '}
        <span className="text-mint font-semibold">non-liquidating leveraged position</span>{' '}
        on Hyperliquid. Your token pumps even when nobody's buying
        — the underlying moves, your coin moves{' '}
        <span className="text-amber font-semibold">2–5× harder</span>.
      </div>
      <button
        className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-sm text-txt-3 hover:text-txt hover:bg-white/[0.06] cursor-pointer bg-transparent border-0 transition-all"
        onClick={dismiss}
        title="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}
