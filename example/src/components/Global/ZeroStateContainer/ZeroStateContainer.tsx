import styles from "./ZeroStateContainer.module.css";

const ZeroStateContainer = ({ children }: { children: React.ReactNode }) => {
  return <div className={styles.container}>{children}</div>;
};

export default ZeroStateContainer;
