import { useState } from "react";

import { buildTelegramUrl, buildTwitterUrl, buildWebsiteUrl } from "@launchpad/shared";

import styles from "./HeroSection.module.css";
import { useCopyState } from "../../hooks/useCopyState";
import { useTokenMarketStats } from "../../hooks/useTokenMarketStats";
import {
  cn,
  copyToClipboard,
  formatCurveFilled,
  formatPercentOrDash,
  formatUsdOrDash,
} from "../../utils/format";
import { tierFor } from "../../utils/vanityTier";
import VanityEffect from "../effects/VanityEffect";
import Button from "../shared/Button";
import Modal from "../shared/Modal";

import type { Token } from "../../services/types";

interface Props {
  token: Token;
}

export default function HeroSection({ token }: Props) {
  const { copied, copy: copyCA } = useCopyState();
  const { copied: copiedDev, copy: copyDev } = useCopyState();
  const [imgError, setImgError] = useState(false);
  const [enlarged, setEnlarged] = useState(false);
  const stats = useTokenMarketStats(token.address);
  const up = (stats.change24h ?? 0) >= 0;

  const shareToken = () => {
    const text = `${token.emoji} ${token.name} · ${formatPercentOrDash(stats.change24h)} today\n${token.ltName} — leveraged tokens`;
    copyToClipboard(text);
  };

  const vanityTier = tierFor(token.address);

  const hasImage = Boolean(token.image && !imgError);
  const fallbackEmoji = token.emoji || "🪙";

  // The API stores handles for Twitter/Telegram and a canonical URL for the
  // website (see issue #400 and `packages/shared/src/social-links.ts`). We
  // *also* run them through the safe builders here so legacy DB rows that
  // still hold raw URLs round-trip into a normalised `https://x.com/<handle>`
  // / `https://t.me/<path>` and any value that can't be reduced to a safe
  // href simply doesn't render — never falls through to a clickable phishing
  // or `javascript:` link.
  const twitterUrl = buildTwitterUrl(token.socialLinks?.twitter);
  const telegramUrl = buildTelegramUrl(token.socialLinks?.telegram);
  const websiteUrl = buildWebsiteUrl(token.socialLinks?.website);

  return (
    <div className={styles.wrapper}>
      <VanityEffect tier={vanityTier} size="hero" as="block">
        <button
          type="button"
          className={cn(styles.avatar, styles.avatarClickable)}
          onClick={() => setEnlarged(true)}
          aria-label={`Enlarge ${token.name} image`}
        >
          {hasImage ? (
            <img
              key={token.image}
              src={token.image}
              alt={token.name}
              className={styles.avatarImage}
              onError={() => setImgError(true)}
            />
          ) : (
            fallbackEmoji
          )}
        </button>
      </VanityEffect>

      <div className={styles.nameBlock}>
        <div className={styles.nameRow}>
          <div className={styles.tokenName}>{token.name}</div>
          <span className={styles.ltBadge}>⚡ {token.ltName}</span>
        </div>
        <div className={styles.metaRow}>
          <div
            className={styles.addrBlock}
            onClick={() => copyDev(token.creatorAddress)}
          >
            <span className={styles.addrLabel}>dev</span>
            <span className={styles.addrText}>
              {`${token.creatorAddress.slice(0, 4)}…${token.creatorAddress.slice(-3)}`}
            </span>
            <span
              className={cn(
                styles.addrIcon,
                copiedDev ? styles.addrIconCopied : styles.addrIconDefault,
              )}
            >
              {copiedDev ? "✓" : "⎘"}
            </span>
          </div>
          <div className={styles.socialLinks}>
            {twitterUrl && (
              <a
                href={twitterUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.socialLink}
              >
                𝕏
              </a>
            )}
            {telegramUrl && (
              <a
                href={telegramUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.socialLink}
              >
                TG
              </a>
            )}
            {websiteUrl && (
              <a
                href={websiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.socialLink}
              >
                🌐
              </a>
            )}
          </div>
          <div
            className={styles.addrBlock}
            onClick={() => copyCA(token.address)}
          >
            <span className={styles.addrLabel}>ca</span>
            <span className={styles.addrText}>
              {`${token.address.slice(0, 4)}…${token.address.slice(-3)}`}
            </span>
            <span
              className={cn(
                styles.addrIcon,
                copied ? styles.addrIconCopied : styles.addrIconDefault,
              )}
            >
              {copied ? "✓" : "⎘"}
            </span>
          </div>
        </div>
      </div>

      <div className={styles.divider} />

      <div className={styles.mcapBlock}>
        <div className={styles.mcapValue}>{formatUsdOrDash(stats.mcapUsd)}</div>
        <div className={styles.changeRow}>
          <span
            className={cn(
              styles.changeValue,
              up ? styles.changeUp : styles.changeDown,
            )}
          >
            {formatPercentOrDash(stats.change24h)}
          </span>
          <span className={styles.changePeriod}>24h</span>
        </div>
      </div>

      <div className={styles.divider} />

      <div className={styles.statsRow}>
        <span className={styles.statValue}>
          Vol 24h{" "}
          <span className={styles.statHighlight}>
            {formatUsdOrDash(token.volume24h)}
          </span>
        </span>
        <span>
          Curve{" "}
          <span className={styles.statHighlight}>{formatCurveFilled(token.curveFilled)}</span>
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

      {enlarged && (
        <Modal
          onClose={() => setEnlarged(false)}
          panelClassName={styles.lightbox}
        >
          {hasImage ? (
            <img
              src={token.image}
              alt={token.name}
              className={styles.lightboxImage}
            />
          ) : (
            <div className={styles.lightboxEmoji}>{fallbackEmoji}</div>
          )}
        </Modal>
      )}
    </div>
  );
}
