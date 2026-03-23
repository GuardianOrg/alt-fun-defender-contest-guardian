import { useState } from 'react';
import styles from './LeverageBanner.module.css';

const STORAGE_KEY = 'bf_lev_banner_v2';

export default function LeverageBanner() {
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem(STORAGE_KEY) === '1');

  if (dismissed) return null;

  const dismiss = () => {
    sessionStorage.setItem(STORAGE_KEY, '1');
    setDismissed(true);
  };

  return (
    <div className={styles.banner}>
      <span className={styles.emoji}>⚡</span>
      <div className={styles.content}>
        Every token is backed by a{' '}
        <span className={styles.highlightMint}>non-liquidating leveraged position</span>{' '}
        on Hyperliquid. Your token pumps even when nobody's buying
        — the underlying moves, your coin moves{' '}
        <span className={styles.highlightAmber}>2–5× harder</span>.
      </div>
      <button
        className={styles.dismissButton}
        onClick={dismiss}
        title="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}
