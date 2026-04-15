import { useState } from "react";

import styles from "./HeroSection.module.css";
import { useCopyState } from "../../hooks/useCopyState";
import { cn, formatUsd, formatPercent, copyToClipboard } from "../../utils/format";
import Button from "../shared/Button";

import type { Token } from "../../services/types";

interface Props {
  token: Token;
}

export default function HeroSection({ token }: Props) {
  const { copied, copy: copyCA } = useCopyState();
  const [imgError, setImgError] = useState(false);
  const up = token.change24h >= 0;

  const shareToken = () => {
    const text = `${token.emoji} ${token.name} · ${formatPercent(token.change24h)} today\n${token.ltName} — leveraged tokens`;
    copyToClipboard(text);
  };

  return (
    <div className={styles.wrapper}>
      <div className={styles.avatar}>
        {token.image && !imgError ? (
          <img
            key={token.image}
            src={token.image}
            alt={token.name}
            className={styles.avatarImage}
            onError={() => setImgError(true)}
          />
        ) : (
          token.emoji || "🪙"
        )}
      </div>

      <div className={styles.nameBlock}>
        <div className={styles.nameRow}>
          <div className={styles.tokenName}>{token.name}</div>
          <span className={styles.ltBadge}>⚡ {token.ltName}</span>
        </div>
        <div className={styles.metaRow}>
          <span className={styles.creatorLabel}>by {token.creatorAddress}</span>
          <div className={styles.socialLinks}>
            {token.socialLinks?.twitter && (
              <a
                href={token.socialLinks.twitter.startsWith("http")
                  ? token.socialLinks.twitter
                  : `https://x.com/${token.socialLinks.twitter.replace(/^@/, "")}`}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.socialLink}
              >
                𝕏
              </a>
            )}
            {token.socialLinks?.telegram && (
              <a
                href={token.socialLinks.telegram.startsWith("http")
                  ? token.socialLinks.telegram
                  : `https://${token.socialLinks.telegram}`}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.socialLink}
              >
                TG
              </a>
            )}
            {token.socialLinks?.website && (
              <a
                href={token.socialLinks.website.startsWith("http")
                  ? token.socialLinks.website
                  : `https://${token.socialLinks.website}`}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.socialLink}
              >
                🌐
              </a>
            )}
          </div>
          <div className={styles.caBlock} onClick={() => copyCA(token.address)}>
            <span
              className={cn(
                styles.caText,
                copied ? styles.caTextCopied : styles.caTextDefault,
              )}
            >
              {copied
                ? "✓"
                : `${token.address.slice(0, 4)}…${token.address.slice(-3)} ⎘`}
            </span>
          </div>
        </div>
      </div>

      <div className={styles.divider} />

      <div className={styles.mcapBlock}>
        <div className={styles.mcapValue}>{formatUsd(token.mcapUsd)}</div>
        <div className={styles.changeRow}>
          <span
            className={cn(
              styles.changeValue,
              up ? styles.changeUp : styles.changeDown,
            )}
          >
            {formatPercent(token.change24h)}
          </span>
          <span className={styles.changePeriod}>24h</span>
        </div>
      </div>

      <div className={styles.divider} />

      <div className={styles.statsRow}>
        <span className={styles.statValue}>
          Vol{" "}
          <span className={styles.statHighlight}>
            {formatUsd(token.volume24h)}
          </span>
        </span>
        <span>
          Curve{" "}
          <span className={styles.statHighlight}>{token.curveFilled}%</span>
        </span>
        <span>
          Lev <span className={styles.statAmber}>{token.leverage}×</span>
        </span>
      </div>

      <div className={styles.shareWrapper}>
        <Button variant="secondary" size="sm" onClick={shareToken}>
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" />
            <polyline points="16 6 12 2 8 6" />
            <line x1="12" y1="2" x2="12" y2="15" />
          </svg>
          Share
        </Button>
      </div>
    </div>
  );
}
