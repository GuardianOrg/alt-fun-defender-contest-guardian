import styles from "./GraduatedPill.module.css";

interface GraduatedPillProps {
  /**
   * Optional native tooltip text — shown on hover in browsers that render
   * `title`. Defaults to a brief explainer so the pill self-documents
   * outside contexts that already have surrounding copy (e.g. the home-
   * page table row).
   */
  title?: string;
}

/**
 * Shared `GRADUATED` lifecycle pill used wherever a token's "this curve
 * has completed and the token now trades on HyperSwap" state needs to be
 * surfaced — currently the home-page token table row and the token-
 * detail hero. Single source of truth for the colour, weight, and shape
 * of the pill so the two surfaces can't drift apart visually.
 *
 * Design notes:
 * - Amber on amber-tinted background. Mint is intentionally avoided — a
 *   sea of graduated rows shouldn't read as "everything is up", and
 *   amber is the codebase's only direction-agnostic lifecycle accent.
 *   See `apps/web/.cursor/rules/design.mdc` color tokens.
 * - Shine sweep, not a pulse. Graduation is a finished state — the
 *   sibling `GraduatingPill` is the one that pulses (heartbeat),
 *   leaving the shimmer free to mean "completed milestone".
 * - `flex-shrink: 0` so the pill never collapses inline next to a long
 *   ticker / token name on narrow viewports.
 */
export default function GraduatedPill({
  title = "This token has graduated — it now trades on HyperSwap",
}: GraduatedPillProps) {
  return (
    <span
      className={styles.pill}
      title={title}
      aria-label="Graduated"
    >
      GRADUATED
    </span>
  );
}
