import styles from "./ThemeToggle.module.css";
import { useTheme } from "../../../../hooks/useTheme";

const ThemeToggle = () => {
  const { theme, toggleTheme } = useTheme();

  return (
    <label className={styles.switchWrapper}>
      <input
        type="checkbox"
        className={styles.hiddenCheckbox}
        checked={theme === "dark"}
        onChange={toggleTheme}
        aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
        data-testid="themeToggle"
      />
      <span className={styles.slider} />
    </label>
  );
};

export default ThemeToggle;
