import styles from "./GeoBlockBanner.module.css";
import { useIsGeoBlocked } from "../../hooks/useIsGeoBlocked";

export default function GeoBlockBanner() {
  const { isGeoBlocked, country } = useIsGeoBlocked();

  if (!isGeoBlocked) return null;

  return (
    <div className={styles.banner} role="alert">
      <span className={styles.icon} aria-hidden>!</span>
      <div className={styles.content}>
        Service unavailable in your region
        {country && <> (<span className={styles.country}>{country}</span>)</>}.
      </div>
    </div>
  );
}
