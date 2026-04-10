import styles from "./Toggle.module.css";

const Toggle = ({
  checked,
  ariaLabel,
  dataTestId,
  disabled,
  onChange,
}: {
  checked: boolean;
  ariaLabel: string;
  dataTestId: string;
  disabled?: boolean;
  onChange: () => void;
}) => {
  return (
    <label
      className={`${styles.switchWrapper} ${disabled ? styles.disabled : ""}`}
    >
      <input
        type="checkbox"
        className={styles.hiddenCheckbox}
        checked={checked}
        onChange={disabled ? undefined : onChange}
        aria-label={ariaLabel}
        data-testid={dataTestId}
      />
      <span
        className={`${styles.slider} ${checked ? styles.sliderChecked : ""}`}
      />
    </label>
  );
};

export default Toggle;
