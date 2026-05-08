import WaveBackground from "../landing/WaveBackground";
import styles from "./Header.module.css";

interface Props {
  title?: string;
  subtitle?: string;
}

export default function Header({
  title = "Terminal",
  subtitle = "Discover and trade tokens backed by Hyperliquid perps.",
}: Props) {
  return (
    <header className={styles.header}>
      <WaveBackground />
      <div className={styles.scrim} aria-hidden="true" />
      <div className={styles.vignette} aria-hidden="true" />
      <div className={styles.content}>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.subtitle}>{subtitle}</p>
      </div>
    </header>
  );
}
