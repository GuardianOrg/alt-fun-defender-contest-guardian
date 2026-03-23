import { Link } from "react-router";

import styles from "./BetaModal.module.css";
import liquidationPointsHero from "../../../assets/liquidation-points/liquidation-points-hero.webp";
import whiteLogo from "../../../assets/white-logo.svg";
import Button from "../../Global/Buttons/Button";

const BetaModal = () => {
  return (
    <div className={styles.hero}>
      <div className={styles.content}>
        <img src={whiteLogo} alt="Bounce logo" className={styles.logo} />
        <p className={styles.byline}>
          Bounce is currently in private beta, register for access.
        </p>
        <Link to={"/register"}>
          <Button variant="primary" size="medium">
            Register
          </Button>
        </Link>
      </div>
      <div className={styles.illustrationContainer}>
        <img src={liquidationPointsHero} alt="" />
      </div>
    </div>
  );
};

export default BetaModal;
