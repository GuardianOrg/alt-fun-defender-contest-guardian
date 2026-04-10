import React, { useState } from "react";

import { usePrivy } from "@privy-io/react-auth";

import styles from "./Button.module.css";
import JellyLoader from "../../../assets/JellyLoader";
import useBounceAccount from "../../../web3/views/useBounceAccount";

export type ButtonVariants =
  | "primary"
  | "secondary"
  | "white"
  | "outlined"
  | "info-blue-outlined"
  | "highlighted"
  | "hyperliquid"
  | "hyperliquid-white"
  | "navigation";

interface ButtonProps {
  variant: ButtonVariants;
  size?: "small" | "medium" | "large";
  onClick?: (() => void) | (() => Promise<void>);
  children?: React.ReactNode;
  icon?: string | React.ReactNode;
  iconPosition?: "left" | "right";
  rounded?: boolean;
  disabled?: boolean;
  loading?: boolean;
  right?: boolean;
  wide?: boolean;
  addressRequired?: boolean;
  noLoadingAnimation?: boolean;
}

const Button = ({
  variant,
  size = "medium",
  onClick,
  children,
  icon,
  iconPosition,
  rounded,
  disabled,
  loading,
  right,
  wide,
  addressRequired,
  noLoadingAnimation,
}: ButtonProps) => {
  const { address } = useBounceAccount();
  const { ready, login } = usePrivy();
  const [isAwaiting, setIsAwaiting] = useState(false);

  const inLoadingState = loading || isAwaiting;

  const classNames = [
    styles.button,
    styles[variant],
    styles[size],
    wide ? styles.wide : "",
    right ? styles.right : "",
    inLoadingState ? styles.loading : "",
    disabled ? styles.disabled : "",
    rounded ? styles.rounded : "",
  ]
    .filter(Boolean)
    .join(" ");

  const variantIconColor: Record<ButtonProps["variant"], string> = {
    primary: "var(--white)",
    secondary: "var(--primary-500-or-white)",
    white: "var(--primary-500)",
    outlined: "var(--primary-text)",
    "info-blue-outlined": "var(--info-300-or-white)",
    highlighted: "var(--primary-500-or-white)",
    hyperliquid: "var(--hl-foam)",
    "hyperliquid-white": "var(--hl-firefly)",
    navigation: "var(--primary-500-or-white)",
  };

  if (addressRequired && !address) {
    return (
      <button className={classNames} onClick={() => login()} disabled={!ready}>
        Connect Wallet
      </button>
    );
  }

  return (
    <button
      className={classNames}
      onClick={async () => {
        if (!onClick || disabled || inLoadingState) return;

        try {
          const result = onClick();
          if (result instanceof Promise) {
            setIsAwaiting(true);
            await result;
          }
        } finally {
          setIsAwaiting(false);
        }
      }}
      disabled={disabled}
    >
      {inLoadingState && !noLoadingAnimation ? (
        <JellyLoader
          size={size === "small" ? 2 : 4}
          color={variantIconColor[variant]}
        />
      ) : (
        <>
          {icon &&
            iconPosition !== "right" &&
            (typeof icon === "string" ? (
              <img className={styles.icon} src={icon} alt="" />
            ) : (
              icon
            ))}

          {children}

          {icon &&
            iconPosition === "right" &&
            (typeof icon === "string" ? (
              <img className={styles.icon} src={icon} alt="" />
            ) : (
              icon
            ))}
        </>
      )}
    </button>
  );
};

export default React.memo(Button);
