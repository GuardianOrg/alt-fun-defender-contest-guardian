import styles from "./DisabledComponent.module.css";

const DisabledComponent = ({
  disableComponent,
  children,
}: {
  disableComponent: boolean;
  children: React.ReactNode;
}) => {
  return (
    <div
      className={`${styles.disabledComponent} ${disableComponent ? styles.active : ""}`}
    >
      {children}
    </div>
  );
};

export default DisabledComponent;
