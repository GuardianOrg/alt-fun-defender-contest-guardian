import { Link } from "react-router";

import styles from "./RegistrationComplete.module.css";
import desktopIllustration from "../../../assets/registration-complete/desktop-view.webp";
import mobileIllustration from "../../../assets/registration-complete/mobile-view.webp";
import { useIsMobile } from "../../../hooks/useIsMobile";
import Button from "../../Global/Buttons/Button";

const RegistrationComplete = () => {
  const isMobile = useIsMobile();
  const imageSrc = isMobile ? mobileIllustration : desktopIllustration;
  return (
    <div
      className={styles.registationComplete}
      style={{
        backgroundImage: `url(${isMobile ? mobileIllustration : desktopIllustration})`,
      }}
    >
      <div className={styles.content}>
        <h2>Registration Complete</h2>
        <Link to="/mint">
          <Button variant="white"> Mint a Leveraged Token</Button>
        </Link>
      </div>
      <img src={imageSrc} alt="Registration Complete" />
    </div>
  );
};

export default RegistrationComplete;
