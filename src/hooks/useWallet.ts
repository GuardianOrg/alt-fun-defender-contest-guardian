import { useAccount, useConnect, useDisconnect, useBalance } from "wagmi";
import { injected } from "wagmi/connectors";

import { shortenAddress } from "../utils/format";

export function useWallet() {
  const { address, isConnected } = useAccount();
  const { connect } = useConnect();
  const { disconnect } = useDisconnect();
  const { data: balance } = useBalance({ address });

  const connectWallet = () => {
    connect({ connector: injected() });
  };

  return {
    address,
    shortAddress: address ? shortenAddress(address) : undefined,
    isConnected,
    balance,
    connect: connectWallet,
    disconnect,
  };
}
