import { useState, useEffect, useCallback } from "react";

import { buildCommentMessage } from "@launchpad/shared";

import styles from "./BottomTabs.module.css";
import { usePrivyWalletClient } from "../../hooks/usePrivyWalletClient";
import { useWallet } from "../../hooks/useWallet";
import { postComment as apiPostComment, fetchComments } from "../../services/api";
import { tradeService } from "../../services/tradeService";
import { formatTimeAgo, shortenAddress } from "../../utils/format";

import type { Token, Comment } from "../../services/types";

export default function CommentsTab({ token }: { token: Token }) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [input, setInput] = useState("");
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const { address, isConnected, connect } = useWallet();
  const walletClient = usePrivyWalletClient();

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
    setPostError(null);
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
    } catch (err: unknown) {
      const message =
        err instanceof Error && err.message.includes("rate")
          ? "Rate limited, try again in 30 seconds."
          : "Failed to post comment. Please try again.";
      setPostError(message);
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
      {postError && (
        <div className={styles.commentError}>{postError}</div>
      )}
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
