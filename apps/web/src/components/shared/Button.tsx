import type { ButtonHTMLAttributes, ReactNode } from "react";

import styles from "./Button.module.css";
import { cn } from "../../utils/format";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
type ButtonSize = "sm" | "md" | "lg";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  busy?: boolean;
  children: ReactNode;
}

export default function Button({
  variant = "primary",
  size = "md",
  fullWidth = false,
  busy = false,
  className,
  disabled,
  children,
  ...rest
}: Props) {
  return (
    <button
      className={cn(
        styles.base,
        styles[variant],
        styles[size],
        fullWidth && styles.fullWidth,
        busy && styles.busy,
        className,
      )}
      type="button"
      disabled={disabled || busy}
      {...rest}
    >
      {children}
    </button>
  );
}
