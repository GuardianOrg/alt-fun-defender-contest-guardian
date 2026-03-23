import { useState, useCallback } from "react";

import { useAccount } from "wagmi";

import {
  tradeRouterService,
  type TxStep,
  type BuyQuote,
  type SellQuote,
} from "../services/tradeRouter";

/**
 * Hook for executing trades through the TX Router.
 *
 * Transaction flow for BUY:
 *   1. Check USDC allowance for Router contract
 *   2. If insufficient, send USDC.approve(router, amount) — user signs tx
 *   3. Call Router.buy(curve, usdcAmount, minTokensOut, referralCode) — user signs tx
 *   4. Router atomically: takes USDC → mints LT via BounceTech → deposits into curve → sends memecoin
 *
 * Transaction flow for SELL:
 *   1. Check memecoin allowance for Router contract
 *   2. If insufficient, send memecoin.approve(router, amount) — user signs tx
 *   3. Call Router.sell(curve, tokenAmount, minUsdcOut, referralCode) — user signs tx
 *   4. Router atomically: takes memecoin → withdraws LT from curve → redeems LT → sends USDC
 *
 * All LT operations are internal to the router. User only sees USDC in/out.
 */
export function useTradeRouter() {
  const { address, isConnected } = useAccount();
  const [step, setStep] = useState<TxStep>("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const getQuoteBuy = useCallback(
    async (
      curveAddress: string,
      usdcAmount: number,
    ): Promise<BuyQuote | null> => {
      try {
        return await tradeRouterService.getQuoteBuy(curveAddress, usdcAmount);
      } catch {
        return null;
      }
    },
    [],
  );

  const getQuoteSell = useCallback(
    async (
      curveAddress: string,
      tokenAmount: number,
      tokenPriceUsd: number,
    ): Promise<SellQuote | null> => {
      try {
        return await tradeRouterService.getQuoteSell(
          curveAddress,
          tokenAmount,
          tokenPriceUsd,
        );
      } catch {
        return null;
      }
    },
    [],
  );

  /**
   * Execute a buy: USDC in → memecoin out (atomic via router).
   *
   * Production implementation:
   *   1. const allowance = await readContract(usdc, 'allowance', [address, routerAddress])
   *   2. if (allowance < amount) await writeContract(usdc, 'approve', [routerAddress, amount])
   *   3. await writeContract(router, 'buy', [curveAddress, amount, minOut, referralCode])
   */
  const executeBuy = useCallback(
    async (_curveAddress: string, _usdcAmount: number, _slippage: number) => {
      if (!isConnected || !address) {
        setError("Connect wallet first");
        return;
      }

      try {
        setError(null);
        setStep("approving");

        // Step 1: USDC approval (mock — production uses writeContract)
        await new Promise((r) => setTimeout(r, 500));

        setStep("executing");

        // Step 2: Router.buy() — atomically mints LT + buys on curve
        await new Promise((r) => setTimeout(r, 1000));

        setTxHash("0x" + Math.random().toString(16).slice(2));
        setStep("confirmed");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Transaction failed");
        setStep("error");
      }
    },
    [isConnected, address],
  );

  /**
   * Execute a sell: memecoin in → USDC out (atomic via router).
   *
   * Production implementation:
   *   1. const allowance = await readContract(token, 'allowance', [address, routerAddress])
   *   2. if (allowance < amount) await writeContract(token, 'approve', [routerAddress, amount])
   *   3. await writeContract(router, 'sell', [curveAddress, amount, minOut, referralCode])
   */
  const executeSell = useCallback(
    async (_curveAddress: string, _tokenAmount: number, _slippage: number) => {
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
        setError(e instanceof Error ? e.message : "Transaction failed");
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
    getQuoteBuy,
    getQuoteSell,
    executeBuy,
    executeSell,
    reset,
  };
}
