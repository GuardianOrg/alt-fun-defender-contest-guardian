import styles from "./TokenCarousel.module.css";
import bitcoin from "../../../../assets/3d-tokens/bitcoin.png";
import ethereum from "../../../../assets/3d-tokens/ethereum.png";
import hype from "../../../../assets/3d-tokens/hype.png";
import { useIsMobile } from "../../../../hooks/useIsMobile";

const tokens = [
  { src: hype, alt: "Hype token" },
  { src: bitcoin, alt: "Bitcoin token" },
  { src: ethereum, alt: "Ethereum token" },
];

type Props = {
  activeIndex: number;
  handleSelect: (index: number) => void;
};

const TokenCarousel = ({ activeIndex, handleSelect }: Props) => {
  const radius = useIsMobile(1180) ? 100 : 120;
  const angleOffset = useIsMobile(1180) ? 55 : 90;

  return (
    <div className={styles.wrapper}>
      {tokens.map((t, i) => {
        const angleDeg = (i - activeIndex) * 120 - angleOffset;
        const angleRad = (angleDeg * Math.PI) / 180;
        const x = Math.sin(angleRad) * radius;
        const y = -Math.cos(angleRad) * radius;
        const transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;

        return (
          <div
            key={i}
            className={`${styles.token} ${
              i === activeIndex ? styles.activeToken : styles.inactiveToken
            } ${styles[`token${i}`]}`}
            style={{ transform }}
            onClick={() => handleSelect(i)}
          >
            <img src={t.src} alt={t.alt} className={styles.tokenImg} />
          </div>
        );
      })}
    </div>
  );
};

export default TokenCarousel;
