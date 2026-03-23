import { useState } from 'react';
import { useTokenTrades } from '@/hooks/useTradeFeed';
import { cn } from '@/utils/format';
import type { Token, Comment, Holder } from '@/services/types';
import { MOCK_COMMENTS, MOCK_HOLDERS } from '@/services/mock/trades';

interface Props {
  token: Token;
}

type Tab = 'trades' | 'comments' | 'holders';

function TradesTab({ token }: { token: Token }) {
  const trades = useTokenTrades(token.address);
  const ticker = token.name.split(' ')[0];

  return (
    <table className="w-full text-[13px]">
      <thead className="sticky top-0 z-10">
        <tr className="text-[11px] tracking-[0.08em] uppercase text-txt-4 bg-bg-1 border-b border-border">
          <th className="text-left font-normal px-4 py-1.5 whitespace-nowrap">Account</th>
          <th className="text-left font-normal px-2 py-1.5 whitespace-nowrap">Type</th>
          <th className="text-right font-normal px-2 py-1.5 whitespace-nowrap">USDC</th>
          <th className="text-right font-normal px-2 py-1.5 whitespace-nowrap">{ticker}</th>
          <th className="text-right font-normal px-2 py-1.5 whitespace-nowrap">Time</th>
          <th className="text-right font-normal px-4 py-1.5 whitespace-nowrap">Txn</th>
        </tr>
      </thead>
      <tbody>
        {trades.map((t) => {
          const mockTxn = t.id.slice(0, 6);
          const isBuy = t.side === 'BUY';
          return (
            <tr
              key={t.id}
              className="border-b border-border cursor-pointer transition-colors hover:bg-white/[0.03]"
            >
              <td className="px-4 py-2 whitespace-nowrap">
                <div className="flex items-center gap-2.5">
                  <img
                    src="/avatar.png"
                    alt=""
                    className="w-7 h-7 rounded-full shrink-0 object-cover bg-bg-2"
                  />
                  <span className="text-txt font-medium">{t.walletAddress}</span>
                </div>
              </td>
              <td className={cn('px-2 py-2 font-semibold whitespace-nowrap', isBuy ? 'text-mint' : 'text-red')}>
                {isBuy ? 'Buy' : 'Sell'}
              </td>
              <td className="px-2 py-2 text-right tabular-nums text-txt-2 whitespace-nowrap">
                ${t.amountUsd.toLocaleString()}
              </td>
              <td className={cn('px-2 py-2 text-right tabular-nums font-semibold whitespace-nowrap', isBuy ? 'text-mint' : 'text-red')}>
                {t.tokensAmount}
              </td>
              <td className="px-2 py-2 text-right tabular-nums text-txt-3 text-[11px] whitespace-nowrap">
                {t.timestamp}
              </td>
              <td className="px-4 py-2 text-right whitespace-nowrap">
                <span className="text-txt-4 hover:text-mint text-[11px] font-mono cursor-pointer transition-colors">
                  {mockTxn}
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function CommentsTab({ comments: initialComments }: { comments: Comment[] }) {
  const [comments, setComments] = useState<Comment[]>(initialComments);
  const [input, setInput] = useState('');

  const postComment = () => {
    const txt = input.trim();
    if (!txt) return;
    setComments((prev) => [
      { id: `new-${Date.now()}`, emoji: '😀', address: '0x4F…3A2C', timeAgo: 'just now', text: txt },
      ...prev,
    ]);
    setInput('');
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-y-auto px-3 py-2 flex flex-col gap-1.5">
        {comments.map((c) => (
          <div key={c.id} className="flex gap-2">
            <div className="w-6 h-6 rounded-full bg-bg-3 border border-border flex items-center justify-center text-[13px] shrink-0">
              {c.emoji}
            </div>
            <div>
              <div>
                <span className="text-[13px] text-mint">{c.address}</span>
                <span className="text-[11px] text-txt-3 ml-1.5">{c.timeAgo}</span>
              </div>
              <div className="text-[13px] text-txt-2 leading-relaxed mt-px">{c.text}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-1.5 px-3 py-1.5 border-t border-border bg-bg-1">
        <input
          className="flex-1 bg-bg-2 border border-border rounded-sm px-2.5 py-1.5 font-mono text-[13px] text-txt outline-0 placeholder:text-txt-4 focus:border-border-2 transition-colors"
          placeholder="say something…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && postComment()}
        />
        <button
          className="bg-mint/[0.06] border border-border-2 text-mint font-mono text-[13px] px-3 rounded-sm cursor-pointer transition-all hover:bg-mint/[0.12]"
          onClick={postComment}
        >
          post
        </button>
      </div>
    </div>
  );
}

function HoldersTab({ holders }: { holders: Holder[] }) {
  const maxSupply = Math.max(...holders.map((h) => h.percentSupply));

  return (
    <div className="h-full overflow-y-auto">
      <div className="grid grid-cols-[28px_1fr_90px_70px_80px] px-4 items-center h-6 text-[11px] tracking-[0.1em] uppercase text-txt-3 bg-bg-1 border-b border-border sticky top-0">
        <div>#</div>
        <div>wallet</div>
        <div>tokens</div>
        <div>% supply</div>
        <div>bar</div>
      </div>
      {holders.map((h) => (
        <div
          key={h.rank}
          className="grid grid-cols-[28px_1fr_90px_70px_80px] px-4 items-center h-7 border-b border-border text-[13px]"
        >
          <div className="text-txt-3 tabular-nums">{h.rank}</div>
          <div className="text-mint">
            {h.address}
            {h.isCreator && (
              <span className="text-[11px] text-amber ml-1.5">creator</span>
            )}
          </div>
          <div className="tabular-nums">{h.tokens}</div>
          <div className="font-semibold tabular-nums">{h.percentSupply}%</div>
          <div>
            <div className="h-[3px] bg-white/[0.06] rounded-full">
              <div
                className="h-full bg-mint-dim bar-glow-mint rounded-full"
                style={{ width: `${(h.percentSupply / maxSupply) * 100}%` }}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function BottomTabs({ token }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('trades');

  return (
    <>
      <div className="shrink-0 border-t border-border bg-bg-1 flex">
        {(['trades', 'comments', 'holders'] as Tab[]).map((tab) => (
          <button
            key={tab}
            className={cn(
              'relative text-[13px] tracking-[0.06em] uppercase text-txt-3 px-5 h-8 flex items-center cursor-pointer bg-transparent border-0 font-mono transition-all duration-150',
              'hover:text-txt hover:bg-white/[0.02]',
              activeTab === tab && 'text-mint font-semibold',
            )}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
            {activeTab === tab && (
              <span className="absolute bottom-0 left-2 right-2 h-[2px] bg-mint rounded-full" />
            )}
          </button>
        ))}
      </div>
      <div className="shrink-0 h-[200px] overflow-y-auto">
        {activeTab === 'trades' && <TradesTab token={token} />}
        {activeTab === 'comments' && <CommentsTab comments={MOCK_COMMENTS} />}
        {activeTab === 'holders' && <HoldersTab holders={MOCK_HOLDERS} />}
      </div>
    </>
  );
}
