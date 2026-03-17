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

  return (
    <div className="h-full overflow-y-auto">
      <div className="grid grid-cols-[50px_80px_90px_80px_1fr_60px] px-4 items-center h-6 text-[10px] tracking-[0.1em] uppercase text-txt-3 bg-bg-1 border-b border-border sticky top-0">
        <div>side</div>
        <div>usdc</div>
        <div>tokens</div>
        <div>wallet</div>
        <div />
        <div>time</div>
      </div>
      {trades.map((t) => (
        <div
          key={t.id}
          className="grid grid-cols-[50px_80px_90px_80px_1fr_60px] px-4 items-center h-7 border-b border-border text-[13px] cursor-pointer transition-colors hover:bg-bg-2"
        >
          <div className={t.side === 'BUY' ? 'text-mint font-bold' : 'text-red font-bold'}>
            {t.side}
          </div>
          <div>${t.amountUsd.toLocaleString()}</div>
          <div className="text-txt-2">{t.tokensAmount}</div>
          <div className="text-mint">{t.walletAddress}</div>
          <div />
          <div className="text-txt-3">{t.timestamp}</div>
        </div>
      ))}
    </div>
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
                <span className="text-[12px] text-mint">{c.address}</span>
                <span className="text-[11px] text-txt-3 ml-[5px]">{c.timeAgo}</span>
              </div>
              <div className="text-[13px] text-txt-2 leading-[1.5] mt-px">{c.text}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-1.5 px-3 py-1.5 border-t border-border bg-bg-1">
        <input
          className="flex-1 bg-bg-2 border border-border rounded-sm px-2.5 py-1.5 font-mono text-[13px] text-txt outline-0 placeholder:text-txt-4 focus:border-border-2"
          placeholder="say something…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && postComment()}
        />
        <button
          className="bg-mint-bg border border-border-2 text-mint font-mono text-[12px] px-3 rounded-sm cursor-pointer"
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
      <div className="grid grid-cols-[28px_1fr_90px_70px_80px] px-4 items-center h-6 text-[10px] tracking-[0.1em] uppercase text-txt-3 bg-bg-1 border-b border-border sticky top-0">
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
          <div className="text-txt-3">{h.rank}</div>
          <div className="text-mint">
            {h.address}
            {h.isCreator && (
              <span className="text-[10px] text-amber ml-1.5">creator</span>
            )}
          </div>
          <div>{h.tokens}</div>
          <div className="font-semibold">{h.percentSupply}%</div>
          <div>
            <div className="h-[3px] bg-white/[0.07] rounded-sm">
              <div
                className="h-full bg-mint-dim rounded-sm"
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
              'text-[12px] tracking-[0.06em] uppercase text-txt-3 px-[18px] h-8 flex items-center cursor-pointer border-r border-border bg-transparent border-t-0 border-b-2 border-b-transparent border-l-0 font-mono transition-all',
              'hover:text-txt-2',
              activeTab === tab && 'text-mint border-b-mint font-semibold',
            )}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </div>
      <div className="shrink-0 h-[185px] overflow-hidden">
        {activeTab === 'trades' && <TradesTab token={token} />}
        {activeTab === 'comments' && <CommentsTab comments={MOCK_COMMENTS} />}
        {activeTab === 'holders' && <HoldersTab holders={MOCK_HOLDERS} />}
      </div>
    </>
  );
}
