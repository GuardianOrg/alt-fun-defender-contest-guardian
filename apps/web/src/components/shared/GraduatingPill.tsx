import styles from "./GraduatingPill.module.css";

interface GraduatingPillProps {
  /**
   * Optional native tooltip text — shown on hover in browsers that render
   * `title`. Defaults to a brief explainer so the pill self-documents
   * outside contexts that already have surrounding copy.
   */
  title?: string;
}

/**
 * Shared `GRADUATING` lifecycle pill — sibling of `GraduatedPill`. Marks a
 * token that's currently in the contract-frozen two-phase graduation
 * window (phase 1 fired, `finalizeGraduation` pending). Visually a
 * direct family-member of `GraduatedPill` — same amber-on-amber-bg, same
 * outline, same shape — but with an opacity pulse instead of the shine
 * sweep, so the in-progress state reads as a heartbeat while the
 * completed state reads as a one-shot glint.
 *
 * Direction-agnostic: a graduating SHORT and a graduating LONG carry the
 * same "this curve is about to flip onto HyperSwap" meaning, and the
 * row's own border-tint already encodes long/short, so the pill itself
 * stays amber.
 */
export default function GraduatingPill({
  title = "This token is graduating — liquidity is being seeded on HyperSwap",
}: GraduatingPillProps) {
  return (
    <span className={styles.pill} title={title} aria-label="Graduating">
      GRADUATING
    </span>
  );
}
