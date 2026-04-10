import { Link } from "react-router";

import styles from "./StartTrading.module.css";
import { MINT_ROUTE } from "../../../app/routes";
import desktopIllustration from "../../../assets/registration-complete/desktop-view.webp";
import mobileIllustration from "../../../assets/registration-complete/mobile-view.webp";
import { useIsMobile } from "../../../hooks/useIsMobile";
import Button from "../../Global/Buttons/Button";

const StartTrading = () => {
  const isMobile = useIsMobile();
  const imageSrc = isMobile ? mobileIllustration : desktopIllustration;
  return (
    <div className={styles.startTrading}>
      <div className={styles.content}>
        <h2>Ready to start trading?</h2>
        <Link to={`/${MINT_ROUTE}`}>
          <Button variant="white"> Mint a Leveraged Token</Button>
        </Link>
      </div>
      <img src={imageSrc} alt="Start trading banner" />
    </div>
  );
};

export default StartTrading;
