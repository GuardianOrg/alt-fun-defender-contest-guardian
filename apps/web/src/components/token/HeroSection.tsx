import { useState } from "react";

import styles from "./HeroSection.module.css";
import { useCopyState } from "../../hooks/useCopyState";
import { cn } from "../../utils/format";
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
  const { copied: shared, copy: copyShareUrl } = useCopyState();
  const [imgError, setImgError] = useState(false);
  const [enlarged, setEnlarged] = useState(false);

  const shareToken = () => {
    copyShareUrl(window.location.href);
  };

  const vanityTier = tierFor(token.address);

  const hasImage = Boolean(token.image && !imgError);
  const fallbackEmoji = token.emoji || "🪙";
  const devShort = `${token.creatorAddress.slice(0, 6)}…${token.creatorAddress.slice(-4)}`;

  return (
    <div className={styles.wrapper}>
      {/* Left: image + ticker / name / by-dev */}
      <div className={styles.rightGroup}>
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

        <div className={styles.nameStack}>
          <div className={styles.tickerNameContainer}>
            <div className={styles.ticker}>{token.ticker}</div>
            <div className={styles.fullName}>{token.name}</div>
          </div>
          <div className={styles.byDev}>
            <span className={styles.byLabel}>By</span>
            <a
              href={`https://hyperevmscan.io/address/${token.creatorAddress}`}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.byLink}
              aria-label={`View creator ${token.creatorAddress} on HyperEVMScan`}
            >
              <span className={styles.byAddr}>{devShort}</span>
              <span className={cn(styles.byIcon, styles.byIconDefault)}>
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </span>
            </a>
          </div>
        </div>
      </div>

      {/* Right: CA + share */}
      <div className={styles.leftGroup}>
        <button
          type="button"
          className={styles.addrBlock}
          onClick={() => copyCA(token.address)}
        >
          <span className={styles.addrText}>
            {`${token.address.slice(0, 6)}…${token.address.slice(-4)}`}
          </span>
          <span
            className={cn(
              styles.addrIcon,
              copied ? styles.addrIconCopied : styles.addrIconDefault,
            )}
          >
            {copied ? "✓" : "⎘"}
          </span>
        </button>
        <Button variant="primary" size="sm" onClick={shareToken}>
          {shared ? (
            <svg
              aria-hidden="true"
              focusable="false"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg
              aria-hidden="true"
              focusable="false"
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
          )}
          {shared ? "Copied!" : "Share"}
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
