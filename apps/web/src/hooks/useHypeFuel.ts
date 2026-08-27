import { useCallback, useState } from "react";

import { createPublicClient, http } from "viem";

import { usePrivyWalletClient } from "./usePrivyWalletClient";
import { useWallet } from "./useWallet";
import { hyperEVM } from "../config/chains";
import {
  HypeFuelError,
  assertHypeFuelAuthorization,
  fillHypeFuel,
  quoteHypeFuel,
  type HypeFuelQuotePreview,
} from "../services/hypefuel";
import { getErrorMessage } from "../utils/format";

const rpcUrl =
  import.meta.env.VITE_RPC_URL || "https://rpc.hyperliquid.xyz/evm";
const hyperEvmClient = createPublicClient({
  chain: hyperEVM,
  transport: http(rpcUrl, { batch: true }),
});

export type HypeFuelPhase = "idle" | "quoting" | "signing" | "filling";

export function useHypeFuel() {
  const { address } = useWallet();
  const walletClient = usePrivyWalletClient();
  const [phase, setPhase] = useState<HypeFuelPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [preview, setPreview] = useState<HypeFuelQuotePreview | null>(null);

  const loadPreview = useCallback(async (user: `0x${string}`) => {
    try {
      const quoted = await quoteHypeFuel(user);
      setPreview(quoted.quote);
      setError(null);
      setErrorCode(null);
    } catch (e) {
      setPreview(null);
      setError(getErrorMessage(e));
      setErrorCode(e instanceof HypeFuelError ? e.code : null);
    }
  }, []);

  const execute = useCallback(async (): Promise<boolean> => {
    if (!address || !walletClient) {
      setError("Connect wallet first");
      setErrorCode(null);
      return false;
    }

    try {
      setError(null);
      setErrorCode(null);
      setPhase("quoting");
      const quoted = await quoteHypeFuel(address);
      setPreview(quoted.quote);

      setPhase("signing");
      const typed = assertHypeFuelAuthorization(
        address,
        quoted.order,
        quoted.typedData,
      );
      const signature = await walletClient.signTypedData({
        account: address,
        ...typed,
      });

      setPhase("filling");
      const { transactionHash } = await fillHypeFuel(quoted.order, signature);
      const receipt = await hyperEvmClient.waitForTransactionReceipt({
        hash: transactionHash,
      });
      if (receipt.status === "reverted") {
        throw new Error("HypeFuel transaction reverted on-chain");
      }
      setPhase("idle");
      return true;
    } catch (e) {
      setError(getErrorMessage(e));
      setErrorCode(e instanceof HypeFuelError ? e.code : null);
      setPhase("idle");
      return false;
    }
  }, [address, walletClient]);

  const reset = useCallback(() => {
    setPhase("idle");
    setError(null);
    setErrorCode(null);
  }, []);

  return {
    phase,
    error,
    errorCode,
    preview,
    inProgress: phase !== "idle",
    loadPreview,
    execute,
    reset,
  };
}
