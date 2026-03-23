import { Link } from "react-router";

import styles from "./LandingPageFooter.module.css";
import { MINT_ROUTE, REGISTER_ROUTE } from "../../../app/routes";
import bounceLogo from "../../../assets/bounce-token.svg";
import { useUserHasRegistered } from "../../../hooks/useUserHasRegistered";
import Button from "../../Global/Buttons/Button";

const LandingPageFooter = () => {
  const { hasRegistered } = useUserHasRegistered();

  return (
    <div className={styles.container}>
      <div className={styles.content}>
        <h2 className={styles.title}>
          <img src={bounceLogo} alt="Start Trading" />
          Start Trading
        </h2>
        <div className={styles.buttonContainer}>
          <Link to={hasRegistered ? MINT_ROUTE : REGISTER_ROUTE}>
            <Button variant="white" rounded size="large">
              {hasRegistered ? "Get started" : "Register"}
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
};

export default LandingPageFooter;
