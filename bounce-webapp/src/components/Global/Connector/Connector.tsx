import { useState } from "react";

import { usePrivy } from "@privy-io/react-auth";
import { useQueryClient } from "@tanstack/react-query";
import { useDisconnect } from "wagmi";

import styles from "./Connector.module.css";
import bounceProfilePicture from "../../../assets/ bounce-profile-picture.svg";
import { Copy } from "../../../assets/Copy";
import { Exit } from "../../../assets/Exit";
import { Tick } from "../../../assets/Tick";
import useFormatAddress from "../../../hooks/useFormatAddress";
import { useIsMobile } from "../../../hooks/useIsMobile";
import useBounceAccount from "../../../web3/views/useBounceAccount";
import Button, { type ButtonVariants } from "../Buttons/Button";
import Popup from "../Popup/Popup";
interface ConnectorProps {
  setMenuOpen?: (open: boolean) => void;
  variant?: ButtonVariants;
}

const Connector = ({ setMenuOpen, variant = "primary" }: ConnectorProps) => {
  const { ready, authenticated, login, logout } = usePrivy();
  const { address, isConnected } = useBounceAccount();
  const { disconnect } = useDisconnect();
  const queryClient = useQueryClient();

  const isMobile = useIsMobile();

  const formattedAddress = useFormatAddress(address, isMobile);

  const [isWalletPopupOpen, setIsWalletPopupOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const buttonText = isConnected ? formattedAddress : "Connect Wallet";

  const statusClasses = [
    styles.status,
    isConnected ? styles.connected : "",
    variant === "white" ? styles.white : "",
    variant === "hyperliquid-white" ? styles["hyperliquid-white"] : "",
  ]
    .filter(Boolean)
    .join(" ");

  // ✅ Main button click
  const handleClick = () => {
    if (setMenuOpen) setMenuOpen(false);
    if (!ready) return;
    if (!authenticated) {
      login();
      return;
    }
    if (!address) {
      login();
      return;
    }
    setIsWalletPopupOpen(true);
  };

  // ✅ Safe logout
  const handleDisconnect = async () => {
    try {
      disconnect();
      queryClient.clear();
      if (authenticated) {
        await logout();
      }
    } catch (err) {
      console.warn("Logout error (safe to ignore):", err);
    } finally {
      setIsWalletPopupOpen(false);
    }
  };

  // ✅ Copy full address
  const handleCopy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      // Show tick for 2 seconds
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Copy failed:", err);
    }
  };

  return (
    <>
      <Popup
        show={isWalletPopupOpen}
        close={() => setIsWalletPopupOpen(false)}
        header="Connected"
        centeredHeader
        maxWidth={"36rem"}
      >
        <div className={styles.popup}>
          <img src={bounceProfilePicture} alt="Bounce Profile" />
          <span>
            {formattedAddress}
            <button onClick={handleCopy} type="button">
              {copied ? (
                <Tick color="var(--primary-500-or-white)" size={14} />
              ) : (
                <Copy color="var(--primary-500-or-white)" size={14} />
              )}
            </button>
          </span>

          <Button
            variant="outlined"
            onClick={handleDisconnect}
            data-testid="logoutButton"
            icon={<Exit size={14} />}
          >
            Disconnect
          </Button>
        </div>
      </Popup>

      <Button
        variant={variant}
        rounded
        size="small"
        onClick={handleClick}
        data-testid="connectorButton"
        disabled={!ready}
      >
        <div className={statusClasses}>
          {isConnected && <div className={styles.pulser} />}
        </div>
        {buttonText}
      </Button>
    </>
  );
};

export default Connector;
