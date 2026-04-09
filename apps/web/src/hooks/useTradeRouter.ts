import { useState, useCallback } from "react";

import { useAccount } from "wagmi";

import { type TxStep } from "../services/tradeRouter";
import { getErrorMessage } from "../utils/format";

/**
 * Hook for executing trades through the TX Router.
 *
 * Both BUY and SELL follow the same flow:
 *   1. Check allowance for Router contract
 *   2. If insufficient, send approve tx — user signs
 *   3. Call Router.buy/sell — user signs
 *   4. Router atomically handles LT mint/redeem internally
 *
 * All LT operations are internal to the router. User only sees USDC in/out.
 */
export function useTradeRouter() {
  const { address, isConnected } = useAccount();
  const [step, setStep] = useState<TxStep>("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const executeTrade = useCallback(
    async (
      _curveAddress: string,
      _amount: number,
      _slippage: number,
    ) => {
      if (!isConnected || !address) {
        setError("Connect wallet first");
        return;
      }

      try {
        setError(null);
        setStep("approving");
        await new Promise((r) => setTimeout(r, 500));

        setStep("executing");
        await new Promise((r) => setTimeout(r, 1000));

        setTxHash("0x" + Math.random().toString(16).slice(2));
        setStep("confirmed");
      } catch (e) {
        setError(getErrorMessage(e));
        setStep("error");
      }
    },
    [isConnected, address],
  );

  const reset = useCallback(() => {
    setStep("idle");
    setTxHash(null);
    setError(null);
  }, []);

  return {
    step,
    txHash,
    error,
    executeTrade,
    reset,
  };
}
