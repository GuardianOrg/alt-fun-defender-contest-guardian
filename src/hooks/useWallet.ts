import { useAccount, useConnect } from "wagmi";
import { injected } from "wagmi/connectors";

import { shortenAddress } from "../utils/format";

export function useWallet() {
  const { address, isConnected } = useAccount();
  const { connect } = useConnect();

  const connectWallet = () => {
    connect({ connector: injected() });
  };

  return {
    address,
    shortAddress: address ? shortenAddress(address) : undefined,
    isConnected,
    connect: connectWallet,
  };
}
