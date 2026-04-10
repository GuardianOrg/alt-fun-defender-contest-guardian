import { useState, useEffect, useCallback } from "react";

import { buildCommentMessage } from "@launchpad/shared";
import { useWalletClient } from "wagmi";

import styles from "./BottomTabs.module.css";
import { useTokenTrades } from "../../hooks/useTradeFeed";
import { useWallet } from "../../hooks/useWallet";
import { postComment as apiPostComment, fetchComments } from "../../services/api";
import { tradeService } from "../../services/tradeService";
import { cn, shortenAddress } from "../../utils/format";

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
                  <div className={styles.walletAvatarPlaceholder} />
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

function CommentsTab({ token }: { token: Token }) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [input, setInput] = useState("");
  const [posting, setPosting] = useState(false);
  const { address, isConnected, connect } = useWallet();
  const { data: walletClient } = useWalletClient();

  useEffect(() => {
    fetchComments(token.address)
      .then((apiComments) => {
        setComments(apiComments.map((c) => ({
          id: String(c.id),
          emoji: "💬",
          address: shortenAddress(c.author),
          timeAgo: formatTimeAgo(c.createdAt),
          text: c.content,
        })));
      })
      .catch(() => {
        tradeService.getComments(token.address).then(setComments);
      });
  }, [token.address]);

  const handlePost = useCallback(async () => {
    const txt = input.trim();
    if (!txt) return;

    if (!isConnected || !address) {
      connect();
      return;
    }

    if (!walletClient) return;

    setPosting(true);
    try {
      const timestamp = Date.now();
      const message = buildCommentMessage(token.address, txt, timestamp);
      const signature = await walletClient.signMessage({ message });

      const created = await apiPostComment(token.address, address, txt, signature, timestamp);

      setComments((prev) => [
        {
          id: String(created.id),
          emoji: "💬",
          address: shortenAddress(address),
          timeAgo: "just now",
          text: created.content,
        },
        ...prev,
      ]);
      setInput("");
    } catch {
      // Silently fail for now; could show error banner
    } finally {
      setPosting(false);
    }
  }, [input, isConnected, address, walletClient, token.address, connect]);

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
          placeholder={isConnected ? "say something…" : "connect wallet to comment"}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handlePost()}
          disabled={posting}
        />
        <button
          className={styles.commentPostBtn}
          onClick={handlePost}
          disabled={posting || !input.trim()}
        >
          {posting ? "…" : "post"}
        </button>
      </div>
    </div>
  );
}

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function HoldersTab({ holders }: { holders: Holder[] }) {
  const maxSupply = Math.max(...holders.map((h) => h.percentSupply), 1);

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
  const [holders, setHolders] = useState<Holder[]>([]);

  useEffect(() => {
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
        {activeTab === "comments" && <CommentsTab token={token} />}
        {activeTab === "holders" && <HoldersTab holders={holders} />}
      </div>
    </>
  );
}
