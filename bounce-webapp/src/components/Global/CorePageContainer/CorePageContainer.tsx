import styles from "./CorePageContainer.module.css";

const CorePageContainer = ({
  wide,
  children,
}: {
  wide?: boolean;
  children: React.ReactNode;
}) => {
  return (
    <div className={`${styles.container} ${wide ? styles.wide : ""}`}>
      {children}
    </div>
  );
};

export default CorePageContainer;
