import styles from "./LiquidationCardContainer.module.css";

import type { OverlayKey, OverlayOption } from "./liquidationOverlays";

interface OverlaySelectorProps {
  activeOverlay: OverlayKey | "none";
  overlays: OverlayOption[];
  bgSquare: string;
  noSelection: string;
  onChange: (overlay: OverlayKey | "none") => void;
}

const OverlaySelector = ({
  activeOverlay,
  overlays,
  bgSquare,
  noSelection,
  onChange,
}: OverlaySelectorProps) => {
  return (
    <section>
      <h3 className={styles.overlayHeading}>Choose an overlay:</h3>
      <div className={styles.overlayOptions}>
        {/* No overlay option */}
        <button
          type="button"
          className={`${styles.overlayOption} ${
            activeOverlay === "none" ? styles.active : ""
          }`}
          onClick={() => onChange("none")}
        >
          <img src={bgSquare} alt="" className={styles.overlayBg} />
          <img
            src={noSelection}
            alt="No overlay"
            className={`${styles.overlayImage} ${styles.noSelection}`}
          />
        </button>

        {overlays.map(({ key, image }) => (
          <button
            key={key}
            type="button"
            className={`${styles.overlayOption} ${
              activeOverlay === key ? styles.active : ""
            }`}
            onClick={() => onChange(key)}
          >
            <img src={bgSquare} alt="" className={styles.overlayBg} />
            <img
              src={image}
              alt={`${key} overlay`}
              className={styles.overlayImage}
            />
          </button>
        ))}
      </div>
    </section>
  );
};

export default OverlaySelector;
