import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useWallet } from '@/hooks/useWallet';
import { useUIStore } from '@/stores/uiStore';
import { cn } from '@/utils/format';

const TABS = [
  { label: 'MARKETS', path: '/' },
  { label: 'PROFILE', action: 'earnings' as const },
  { label: 'ALERTS', path: '#' },
  { label: 'DOCS', path: '#' },
];

export default function Header() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isConnected, shortAddress, connect } = useWallet();
  const setSearchOpen = useUIStore((s) => s.setSearchOpen);
  const setEarningsOpen = useUIStore((s) => s.setEarningsOpen);
  const [clock, setClock] = useState('--:--:-- UTC');

  useEffect(() => {
    const tick = () => {
      const n = new Date();
      setClock(
        `${String(n.getUTCHours()).padStart(2, '0')}:${String(n.getUTCMinutes()).padStart(2, '0')}:${String(n.getUTCSeconds()).padStart(2, '0')} UTC`,
      );
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const isCreate = location.pathname === '/create';

  return (
    <header className="flex items-center h-[44px] bg-bg-1 border-b border-border-2 px-4 shrink-0">
      <div
        className="text-sm font-bold text-mint tracking-[0.08em] mr-5 cursor-pointer"
        onClick={() => navigate('/')}
      >
        BOUNCE<span className="text-txt font-bold" style={{ fontStyle: 'normal' }}>.FUN</span>
      </div>
      <div className="text-[11px] tracking-[0.12em] uppercase text-txt-3 border-l border-border pl-3 mr-5">
        perps × memes
      </div>

      <div className="flex">
        {TABS.map((tab) => {
          const hasPath = 'path' in tab;
          const isActive = hasPath && tab.path === '/' && location.pathname === '/';
          return (
            <button
              key={tab.label}
              className={cn(
                'font-mono text-[12px] tracking-[0.06em] uppercase text-txt-3 px-3.5 h-[44px] flex items-center cursor-pointer',
                'border-r border-border bg-transparent border-t-0 border-b-2 border-b-transparent border-l-0 transition-all duration-100',
                'first:border-l first:border-l-border',
                'hover:text-txt hover:bg-mint/[0.06]',
                isActive && 'text-white bg-mint/[0.12] border-b-mint font-bold',
              )}
              onClick={() => {
                if ('action' in tab && tab.action === 'earnings') {
                  setEarningsOpen(true);
                } else if (hasPath && tab.path !== '#') {
                  navigate(tab.path!);
                }
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {!isCreate && (
        <div
          className="flex items-center gap-2 bg-white/[0.04] border border-border rounded-[3px] px-2.5 py-1 cursor-pointer h-7 ml-4 transition-all hover:border-border-2"
          onClick={() => setSearchOpen(true)}
        >
          <span className="text-sm text-txt-3">⌕</span>
          <span className="text-[13px] text-txt-3 whitespace-nowrap">Search tokens…</span>
          <span className="text-[11px] text-txt-3 bg-white/[0.06] border border-border rounded-sm px-[5px] py-px ml-1">
            ⌘K
          </span>
        </div>
      )}

      <div className="ml-auto flex items-center gap-3">
        <span className="text-[12px] text-txt-3">{clock}</span>
        {isConnected ? (
          <span
            className="text-[12px] text-mint border border-border-2 px-2.5 py-[3px] rounded-sm cursor-pointer hover:bg-mint/10 transition-all"
            onClick={() => setEarningsOpen(true)}
          >
            {shortAddress}
          </span>
        ) : (
          <button
            className="text-[12px] text-mint border border-border-2 px-2.5 py-[3px] rounded-sm cursor-pointer hover:bg-mint/10"
            onClick={connect}
          >
            Connect Wallet
          </button>
        )}
        {isCreate ? (
          <button className="font-mono text-[13px] font-bold text-mint bg-mint/[0.15] px-[18px] py-1.5 rounded-sm border-0 tracking-[0.06em] uppercase h-[44px] flex items-center cursor-default shadow-none whitespace-nowrap">
            ⚡ creating token
          </button>
        ) : (
          <button
            className="font-mono text-[13px] font-bold text-bg bg-mint px-[18px] py-1.5 rounded-sm border-0 tracking-[0.06em] uppercase h-[44px] flex items-center cursor-pointer shadow-[0_0_16px_rgba(77,232,180,0.3)] whitespace-nowrap transition-all hover:bg-[#6ef0c2]"
            onClick={() => navigate('/create')}
          >
            ⚡ launch a levered memecoin
          </button>
        )}
      </div>
    </header>
  );
}
