import styles from "./LockedPill.module.css";
import { lockClaim } from "../../utils/locks";

interface LockedPillProps {
  /** Share of the 1B initial supply that is locked, 0–100. */
  percent: number;
  /** ISO timestamp at which the locked supply becomes sellable. */
  unlocksAt: string;
}

/**
 * Shows the share of a token's supply held in a Sablier timelock — a token
 * whose creator has provably given up the ability to sell it for a while.
 * Rendered next to the ticker on the home-page rows and the token-detail hero.
 *
 * Deliberately monochrome and static, unlike its `GraduatedPill` /
 * `CommunityTakeoverPill` siblings. Both of those animate a shimmer, and a
 * safety claim is the last thing that should be dressed up to catch the eye —
 * a locked supply is a fact worth stating plainly, not a celebration. Staying
 * neutral also keeps the pill off the accent palette, where amber already
 * means GRADUATED and mint already means LONG.
 */
export default function LockedPill({ percent, unlocksAt }: LockedPillProps) {
  const claim = lockClaim(percent, unlocksAt);
  return (
    <span className={styles.pill} title={claim} aria-label={claim}>
      {Math.round(percent)}% LOCKED
    </span>
  );
}
