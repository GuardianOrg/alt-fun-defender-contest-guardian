import { ConnectButton } from "@rainbow-me/rainbowkit";

import styles from "./Connector.module.css";
import useFormatAddress from "../../../hooks/useFormatAddress";
import { useIsMobile } from "../../../hooks/useIsMobile";
import useBounceAccount from "../../../web3/views/useBounceAccount";
import Button from "../Buttons/Button";

interface ConnectorProps {
  setMenuOpen?: (open: boolean) => void;
  white?: boolean;
}

const Connector = ({ setMenuOpen, white = false }: ConnectorProps) => {
  const { address } = useBounceAccount();
  const isMobile = useIsMobile();
  const formattedAddress = useFormatAddress(address, isMobile);

  return (
    <ConnectButton.Custom>
      {({
        account,
        chain,
        openAccountModal,
        openChainModal,
        openConnectModal,
        authenticationStatus,
        mounted,
      }) => {
        const ready = mounted && authenticationStatus !== "loading";
        const isConnected =
          ready &&
          account &&
          chain &&
          (!authenticationStatus || authenticationStatus === "authenticated");
        const wrongNetwork = chain?.unsupported;

        const handleClick = () => {
          if (setMenuOpen) setMenuOpen(false);
          if (wrongNetwork) return openChainModal();
          if (!isConnected) return openConnectModal();
          openAccountModal();
        };

        const buttonVariant = isConnected
          ? "primary"
          : white
            ? "white"
            : "primary";

        const statusClasses = [
          styles.status,
          isConnected && !wrongNetwork ? styles.connected : "",
          wrongNetwork ? styles.error : "",
          white ? styles.white : "",
        ]
          .filter(Boolean)
          .join(" ");

        let buttonText = "Connect Wallet";
        if (wrongNetwork) buttonText = "Wrong network";
        else if (isConnected) buttonText = formattedAddress;

        return (
          <Button
            variant={buttonVariant}
            rounded
            size="small"
            onClick={handleClick}
            disabled={!ready}
            data-testid="connectorButton"
          >
            <div className={statusClasses}>
              {isConnected && !wrongNetwork && (
                <div className={styles.pulser} />
              )}
            </div>
            {buttonText}
          </Button>
        );
      }}
    </ConnectButton.Custom>
  );
};

export default Connector;
