import styles from "./LoginCards.module.css";
import JellyLoader from "../../../assets/JellyLoader";

const LoadingCard = () => {
  return (
    <div className={`${styles.loadingCard}`}>
      <JellyLoader />
    </div>
  );
};

export default LoadingCard;
