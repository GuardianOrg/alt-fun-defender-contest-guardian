import { Link } from "react-router";

import styles from "./LoginCards.module.css";
import { MINT_ROUTE, REGISTER_ROUTE } from "../../../app/routes";
import { useUserHasRegistered } from "../../../hooks/useUserHasRegistered";
import Button from "../../Global/Buttons/Button";

const PostLoginCard = () => {
  const { hasRegistered } = useUserHasRegistered();

  // if this card has rendered, set a local storage item "no_liquidations" to true
  localStorage.setItem("no_liquidations", "true");

  return (
    <div className={styles.mainCard}>
      <div>
        <h2 className={styles.mainCardTitle}>Wallet not eligible</h2>
        <p className={styles.mainCardText}>
          {hasRegistered ? (
            "Try a different wallet or mint your first leveraged token"
          ) : (
            <>
              Try a different wallet or register with code{" "}
              <span className={styles.code}>no_liquidations</span> to get
              started
            </>
          )}
        </p>
      </div>
      {hasRegistered ? (
        <Link to={`/${MINT_ROUTE}`}>
          <Button variant="white">Mint a Leveraged Token</Button>
        </Link>
      ) : (
        <Link to={`/${REGISTER_ROUTE}`}>
          <Button variant="white">Register</Button>
        </Link>
      )}
    </div>
  );
};

export default PostLoginCard;
