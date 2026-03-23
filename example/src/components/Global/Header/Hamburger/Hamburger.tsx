import styles from "./Hamburger.module.css";

interface HamburgerProps {
  open: boolean;
  onToggle: (toggle: boolean) => void;
}

const Hamburger = ({ open, onToggle }: HamburgerProps) => {
  const toggle = () => onToggle(!open);

  return (
    <button
      type="button"
      aria-pressed={open}
      aria-label="Menu"
      title="Menu"
      onClick={toggle}
      className={`${styles.button} ${open ? styles.open : ""}`}
      data-testid="hamburger"
    >
      <span className={styles.srOnly}>{open ? "Close" : "Open"} menu</span>
      <span className={styles.line} />
      <span className={styles.line} />
      <span className={styles.line} />
      <span className={styles.line} />
    </button>
  );
};

export default Hamburger;
