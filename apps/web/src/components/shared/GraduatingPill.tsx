import styles from "./GraduatingPill.module.css";

interface GraduatingPillProps {
  /**
   * Optional native tooltip text — shown on hover in browsers that render
   * `title`. Defaults to a brief explainer so the pill self-documents
   * outside contexts that already have surrounding copy.
   */
  title?: string;
}

export default function GraduatingPill({
  title = "This token is graduating — liquidity is being seeded on HyperSwap",
}: GraduatingPillProps) {
  return (
    <span className={styles.pill} title={title} aria-label="Graduating">
      GRADUATING
    </span>
  );
}
