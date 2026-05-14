import styles from "./Header.module.css";
import WaveBackground from "../effects/WaveBackground";

export default function Header() {
  return (
    <header className={styles.header}>
      <div className={styles.waveLayer} aria-hidden="true">
        <WaveBackground scale={1.6} />
      </div>
      <div className={styles.scrim} aria-hidden="true" />
      <div className={styles.vignette} aria-hidden="true" />
      <div className={styles.content}>
        <h1 className={styles.title}>
          <span>Launch coins</span>
          <span className={styles.titleSlash} aria-hidden="true">
            /
          </span>
          <span className={styles.titleAccent}>backed by perps</span>
        </h1>
        <span className={styles.subtitleContainer}>
          <p className={styles.subtitle}>
            Every token is backed by a{" "}
            <span className={styles.mint}>non-liquidating Hyperliquid perp</span>.
          </p>
          <p className={styles.subtitleItalic}>
            Your token pumps even when nobody&apos;s buying — when the
            underlying moves, your coin moves{" "}
            <span className={styles.mint}>2-5x harder</span>.
          </p>
        </span>
      </div>
    </header>
  );
}
