import { Logo } from "../../../../../assets/Logo";
import { useIsMobile } from "../../../../../hooks/useIsMobile";
import styles from "../LiquidationJourneyCard.module.css";
export const Header = () => {
  const isMobile = useIsMobile(768);
  return (
    <div className={styles.logoContainer}>
      <Logo color="var(--hl-foam)" size={isMobile ? 90 : 120} />
      <span>HYPERLIQUID LIQUIDATIONS WRAPPED</span>
    </div>
  );
};
