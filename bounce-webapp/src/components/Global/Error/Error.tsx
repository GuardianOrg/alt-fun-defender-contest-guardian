import styles from "./Error.module.css";
import errorIcon from "../../../assets/error.svg";

interface ErrorProps {
  message: string;
}

const Error = ({ message }: ErrorProps) => {
  return (
    <div className={styles.error}>
      <div className={styles.content}>
        <img className={styles.errorIcon} src={errorIcon} />
        <p className={styles.errorMessage}>{message}</p>
      </div>
    </div>
  );
};

export default Error;
