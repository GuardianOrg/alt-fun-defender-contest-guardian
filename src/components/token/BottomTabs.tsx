import { useState, useEffect } from "react";

import styles from "./BottomTabs.module.css";
import { useTokenTrades } from "../../hooks/useTradeFeed";
import { tradeService } from "../../services/tradeService";
import { cn } from "../../utils/format";

import type { Token, Comment, Holder } from "../../services/types";

interface Props {
  token: Token;
}

type Tab = "trades" | "comments" | "holders";

function TradesTab({ token }: { token: Token }) {
  const trades = useTokenTrades(token.address);
  const ticker = token.ticker;

  return (
    <table className={styles.tradesTable}>
      <thead className={styles.tradesHead}>
        <tr className={styles.tradesHeaderRow}>
          <th className={styles.thLeft}>Account</th>
          <th className={styles.thLeftSmall}>Type</th>
          <th className={styles.thRight}>USDC</th>
          <th className={styles.thRight}>{ticker}</th>
          <th className={styles.thRight}>Time</th>
          <th className={styles.thRightWide}>Txn</th>
        </tr>
      </thead>
      <tbody>
        {trades.map((t) => {
          const mockTxn = t.id.slice(0, 6);
          const isBuy = t.side === "BUY";
          return (
            <tr key={t.id} className={styles.tradeRow}>
              <td className={styles.tdLeft}>
                <div className={styles.walletCell}>
                  <img
                    src="/avatar.png"
                    alt=""
                    className={styles.walletAvatar}
                  />
                  <span className={styles.walletAddress}>
                    {t.walletAddress}
                  </span>
                </div>
              </td>
              <td
                className={cn(
                  styles.tdType,
                  isBuy ? styles.tdTypeBuy : styles.tdTypeSell,
                )}
              >
                {isBuy ? "Buy" : "Sell"}
              </td>
              <td className={styles.tdUsdc}>${t.amountUsd.toLocaleString()}</td>
              <td
                className={cn(
                  styles.tdTokens,
                  isBuy ? styles.tdTokensBuy : styles.tdTokensSell,
                )}
              >
                {t.tokensAmount}
              </td>
              <td className={styles.tdTime}>{t.timestamp}</td>
              <td className={styles.tdTxn}>
                <span className={styles.txnLink}>{mockTxn}</span>
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
  const [input, setInput] = useState("");

  const postComment = () => {
    const txt = input.trim();
    if (!txt) return;
    setComments((prev) => [
      {
        id: `new-${Date.now()}`,
        emoji: "😀",
        address: "0x4F…3A2C",
        timeAgo: "just now",
        text: txt,
      },
      ...prev,
    ]);
    setInput("");
  };

  return (
    <div className={styles.commentsWrap}>
      <div className={styles.commentsList}>
        {comments.map((c) => (
          <div key={c.id} className={styles.commentRow}>
            <div className={styles.commentAvatar}>{c.emoji}</div>
            <div>
              <div>
                <span className={styles.commentAddress}>{c.address}</span>
                <span className={styles.commentTime}>{c.timeAgo}</span>
              </div>
              <div className={styles.commentText}>{c.text}</div>
            </div>
          </div>
        ))}
      </div>
      <div className={styles.commentInputRow}>
        <input
          className={styles.commentInput}
          placeholder="say something…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && postComment()}
        />
        <button className={styles.commentPostBtn} onClick={postComment}>
          post
        </button>
      </div>
    </div>
  );
}

function HoldersTab({ holders }: { holders: Holder[] }) {
  const maxSupply = Math.max(...holders.map((h) => h.percentSupply));

  return (
    <div className={styles.holdersWrap}>
      <div className={styles.holdersHeader}>
        <div>#</div>
        <div>wallet</div>
        <div>tokens</div>
        <div>% supply</div>
        <div>bar</div>
      </div>
      {holders.map((h) => (
        <div key={h.rank} className={styles.holderRow}>
          <div className={styles.holderRank}>{h.rank}</div>
          <div className={styles.holderAddress}>
            {h.address}
            {h.isCreator && (
              <span className={styles.holderCreator}>creator</span>
            )}
          </div>
          <div className={styles.holderTokens}>{h.tokens}</div>
          <div className={styles.holderPercent}>{h.percentSupply}%</div>
          <div>
            <div className={styles.barTrack}>
              <div
                className={cn(styles.barFill, "bar-glow-mint")}
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
  const [activeTab, setActiveTab] = useState<Tab>("trades");
  const [comments, setComments] = useState<Comment[]>([]);
  const [holders, setHolders] = useState<Holder[]>([]);

  useEffect(() => {
    tradeService.getComments(token.address).then(setComments);
    tradeService.getHolders(token.address).then(setHolders);
  }, [token.address]);

  return (
    <>
      <div className={styles.tabBar}>
        {(["trades", "comments", "holders"] as Tab[]).map((tab) => (
          <button
            key={tab}
            className={cn(
              styles.tabBtn,
              activeTab === tab && styles.tabBtnActive,
            )}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
            {activeTab === tab && <span className={styles.tabIndicator} />}
          </button>
        ))}
      </div>
      <div className={styles.tabContent}>
        {activeTab === "trades" && <TradesTab token={token} />}
        {activeTab === "comments" && <CommentsTab comments={comments} />}
        {activeTab === "holders" && <HoldersTab holders={holders} />}
      </div>
    </>
  );
}
