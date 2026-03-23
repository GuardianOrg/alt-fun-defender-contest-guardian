import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useWallet } from '@/hooks/useWallet';
import { useUIStore } from '@/stores/uiStore';
import { cn } from '@/utils/format';

const TABS = [
  { label: 'MARKETS', path: '/' },
  { label: 'PROFILE', action: 'earnings' as const },
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
    <header className="flex items-center h-[44px] bg-bg-1 border-b border-border-2 px-4 shrink-0 relative">
      {/* Logo */}
      <div
        className="text-sm font-bold tracking-[0.08em] mr-5 cursor-pointer select-none"
        onClick={() => navigate('/')}
      >
        <span className="text-mint drop-shadow-[0_0_8px_rgba(77,232,180,0.4)]">BOUNCE</span>
        <span className="text-txt font-bold">.FUN</span>
      </div>

      <div className="text-[13px] tracking-[0.12em] uppercase border-l border-border pl-3 mr-5 font-bold">
        <span className="text-mint drop-shadow-[0_0_6px_rgba(77,232,180,0.3)]">leverage</span>
        <span className="text-txt-2 mx-1">×</span>
        <span className="text-txt">memes</span>
      </div>

      {/* Nav tabs */}
      <nav className="flex h-full">
        {TABS.map((tab) => {
          const hasPath = 'path' in tab;
          const isActive = hasPath && tab.path === '/' && location.pathname === '/';
          return (
            <button
              key={tab.label}
              className={cn(
                'relative font-mono text-[13px] tracking-[0.06em] uppercase px-4 h-full flex items-center cursor-pointer',
                'bg-transparent border-0 transition-all duration-150',
                'text-txt-3 hover:text-txt hover:bg-white/[0.03]',
                isActive && 'text-txt bg-white/[0.04]',
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
              {isActive && (
                <span className="absolute bottom-0 left-2 right-2 h-[2px] bg-mint rounded-full" />
              )}
            </button>
          );
        })}
      </nav>

      {/* Search */}
      {!isCreate && (
        <div
          className="flex items-center gap-2 bg-white/[0.03] border border-border rounded-[3px] px-2.5 py-1 cursor-pointer h-7 ml-4 transition-all hover:border-border-2 hover:bg-white/[0.05]"
          onClick={() => setSearchOpen(true)}
        >
          <span className="text-sm text-txt-3">⌕</span>
          <span className="text-[13px] text-txt-3 whitespace-nowrap">Search tokens…</span>
          <span className="text-[11px] text-txt-4 bg-white/[0.05] border border-border rounded-sm px-1 py-px ml-1 font-mono">
            ⌘K
          </span>
        </div>
      )}

      {/* Right side */}
      <div className="ml-auto flex items-center gap-3">
        <span className="text-[13px] text-txt-3 tabular-nums">{clock}</span>
        {isConnected ? (
          <span
            className="text-[13px] text-mint border border-border-2 px-2.5 py-[3px] rounded-sm cursor-pointer transition-all hover:bg-mint/10 hover:border-mint/40"
            onClick={() => setEarningsOpen(true)}
          >
            {shortAddress}
          </span>
        ) : (
          <button
            className="text-[13px] text-mint border border-border-2 px-2.5 py-[3px] rounded-sm cursor-pointer hover:bg-mint/10"
            onClick={connect}
          >
            Connect Wallet
          </button>
        )}
        {isCreate ? (
          <button className="font-mono text-[13px] font-bold text-mint bg-mint/[0.12] px-5 py-1.5 rounded-sm border-0 tracking-[0.06em] uppercase h-[44px] flex items-center cursor-default whitespace-nowrap">
            ⚡ creating token
          </button>
        ) : (
          <button
            className="font-mono text-[13px] font-bold text-bg bg-mint px-5 py-1.5 rounded-sm border-0 tracking-[0.06em] uppercase h-[44px] flex items-center cursor-pointer shadow-mint-glow whitespace-nowrap transition-all hover:bg-mint-hover"
            onClick={() => navigate('/create')}
          >
            ⚡ launch a levered token
          </button>
        )}
      </div>
    </header>
  );
}
