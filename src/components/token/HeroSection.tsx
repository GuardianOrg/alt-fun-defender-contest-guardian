import { useState } from 'react';
import { cn, formatUsd, formatPercent } from '@/utils/format';
import type { Token } from '@/services/types';
import styles from './HeroSection.module.css';

interface Props {
  token: Token;
}

export default function HeroSection({ token }: Props) {
  const [copied, setCopied] = useState(false);
  const up = token.change24h >= 0;

  const copyCA = () => {
    navigator.clipboard.writeText(token.address).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const shareToken = () => {
    const text = `${token.emoji} ${token.name} · ${formatPercent(token.change24h)} today\n${token.ltName} — leveraged tokens\n\nbounce.fun`;
    navigator.clipboard.writeText(text).catch(() => {});
  };

  return (
    <div className={styles.wrapper}>
      <div className={styles.avatar}>
        {token.image ? (
          <img src={token.image} alt={token.name} className={styles.avatarImage} />
        ) : (
          token.emoji
        )}
      </div>

      <div className={styles.nameBlock}>
        <div className={styles.nameRow}>
          <div className={styles.tokenName}>
            {token.name}
          </div>
          <span className={styles.ltBadge}>
            ⚡ {token.ltName}
          </span>
        </div>
        <div className={styles.metaRow}>
          <span className={styles.creatorLabel}>
            by {token.creatorAddress}
          </span>
          <div className={styles.socialLinks}>
            {['𝕏', 'TG'].map((s) => (
              <span
                key={s}
                className={styles.socialLink}
              >
                {s}
              </span>
            ))}
          </div>
          <div
            className={styles.caBlock}
            onClick={copyCA}
          >
            <span className={cn(styles.caText, copied ? styles.caTextCopied : styles.caTextDefault)}>
              {copied ? '✓' : `${token.address.slice(0, 4)}…${token.address.slice(-3)} ⎘`}
            </span>
          </div>
        </div>
      </div>

      <div className={styles.divider} />

      <div className={styles.mcapBlock}>
        <div className={styles.mcapValue}>
          {formatUsd(token.mcapUsd)}
        </div>
        <div className={styles.changeRow}>
          <span className={cn(styles.changeValue, up ? styles.changeUp : styles.changeDown)}>
            {formatPercent(token.change24h)}
          </span>
          <span className={styles.changePeriod}>24h</span>
        </div>
      </div>

      <div className={styles.divider} />

      <div className={styles.statsRow}>
        <span className={styles.statValue}>Vol <span className={styles.statHighlight}>{formatUsd(token.volume24h)}</span></span>
        <span>Curve <span className={styles.statHighlight}>{token.curveFilled}%</span></span>
        <span>Lev <span className={styles.statAmber}>{token.leverage}×</span></span>
      </div>

      <div className={styles.shareWrapper}>
        <button
          className={styles.shareBtn}
          onClick={shareToken}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" />
            <polyline points="16 6 12 2 8 6" />
            <line x1="12" y1="2" x2="12" y2="15" />
          </svg>
          Share
        </button>
      </div>
    </div>
  );
}
