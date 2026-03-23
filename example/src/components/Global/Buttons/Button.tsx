import React, { useState } from "react";

import { ConnectButton } from "@rainbow-me/rainbowkit";

import styles from "./Button.module.css";
import JellyLoader from "../../../assets/JellyLoader";
import useBounceAccount from "../../../web3/views/useBounceAccount";

interface ButtonProps {
  variant:
    | "primary"
    | "secondary"
    | "white"
    | "outlined"
    | "info-blue-outlined"
    | "highlighted";
  size?: "small" | "medium" | "large";
  onClick?: (() => void) | (() => Promise<void>);
  children?: React.ReactNode;
  icon?: string;
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
  rounded,
  disabled,
  loading,
  right,
  wide,
  addressRequired,
  noLoadingAnimation,
}: ButtonProps) => {
  const { address } = useBounceAccount();
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
  };

  if (addressRequired && !address) {
    return (
      <ConnectButton.Custom>
        {({ openConnectModal, mounted }) => {
          const ready = mounted;
          return (
            <button
              className={classNames}
              onClick={openConnectModal}
              disabled={!ready}
            >
              {inLoadingState ? (
                <JellyLoader size={4} color={variantIconColor[variant]} />
              ) : (
                "Connect Wallet"
              )}
            </button>
          );
        }}
      </ConnectButton.Custom>
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
          {icon && <img className={styles.icon} src={icon} />}
          {children}
        </>
      )}
    </button>
  );
};

export default React.memo(Button);
