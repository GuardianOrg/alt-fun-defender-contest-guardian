import { useEffect, useRef } from "react";

import { useSelector } from "react-redux";
import { useChainId, useSwitchChain } from "wagmi";

import { hyperEvm } from "../constants/hyperEvm";
import { selectDepositIsOpen } from "../state/depositSlice";
import useBounceAccount from "../web3/views/useBounceAccount";

/**
 * Keeps an active wallet session on HyperEVM. Skips enforcement while the LiFi
 * deposit modal is open so users can operate on source chains.
 */
const HyperEvmChainHandler = () => {
  const { isConnected } = useBounceAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const depositOpen = useSelector(selectDepositIsOpen);
  const switchInFlightRef = useRef(false);

  useEffect(() => {
    if (!isConnected || depositOpen) return;
    if (chainId === hyperEvm.id) return;
    if (!switchChainAsync || switchInFlightRef.current) return;

    switchInFlightRef.current = true;
    void switchChainAsync({ chainId: hyperEvm.id })
      .catch(() => {
        /* user reject or wallet limitation */
      })
      .finally(() => {
        switchInFlightRef.current = false;
      });
  }, [isConnected, chainId, depositOpen, switchChainAsync]);

  return null;
};

export default HyperEvmChainHandler;
