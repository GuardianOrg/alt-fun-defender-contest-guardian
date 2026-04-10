import { useState, useCallback } from "react";

import { maxUint256, parseUnits } from "viem";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";

import { erc20Abi, RedemptionRouterAbi } from "../contracts/abis";
import { ADDRESSES, USDC_DECIMALS } from "../contracts/addresses";
import { type TxStep } from "../services/tradeRouter";
import { getErrorMessage } from "../utils/format";

function slippageToBps(slippage: number): number {
  const clamped = Number.isFinite(slippage) ? Math.max(slippage, 0) : 0;
  return Math.min(Math.floor(clamped * 100), 10_000);
}

export function useTradeRouter() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const [step, setStep] = useState<TxStep>("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const executeBuy = useCallback(
    async (tokenAddress: string, usdcAmount: number, slippage: number) => {
      if (!isConnected || !address || !walletClient || !publicClient) {
        setError("Connect wallet first");
        return;
      }

      try {
        setError(null);
        setStep("approving");

        const usdcAmountWei = parseUnits(usdcAmount.toString(), USDC_DECIMALS);
        const routerAddr = ADDRESSES.redemptionRouter;

        const allowance = await publicClient.readContract({
          address: ADDRESSES.usdc,
          abi: erc20Abi,
          functionName: "allowance",
          args: [address, routerAddr],
        });

        if ((allowance as bigint) < usdcAmountWei) {
          const approveTx = await walletClient.writeContract({
            address: ADDRESSES.usdc,
            abi: erc20Abi,
            functionName: "approve",
            args: [routerAddr, maxUint256],
          });
          await publicClient.waitForTransactionReceipt({ hash: approveTx });
        }

        setStep("executing");

        const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
        const referrer =
          "0x0000000000000000000000000000000000000000" as `0x${string}`;

        const slippageBps = slippageToBps(slippage);
        const { result: quotedTokensOut } =
          await publicClient.simulateContract({
            address: routerAddr,
            abi: RedemptionRouterAbi,
            functionName: "buy",
            args: [
              tokenAddress as `0x${string}`,
              usdcAmountWei,
              0n,
              deadline,
              referrer,
            ],
            account: address,
          });
        const minTokensOut =
          ((quotedTokensOut as bigint) * BigInt(10_000 - slippageBps)) /
          10_000n;

        const buyTx = await walletClient.writeContract({
          address: routerAddr,
          abi: RedemptionRouterAbi,
          functionName: "buy",
          args: [
            tokenAddress as `0x${string}`,
            usdcAmountWei,
            minTokensOut,
            deadline,
            referrer,
          ],
        });

        await publicClient.waitForTransactionReceipt({ hash: buyTx });
        setTxHash(buyTx);
        setStep("confirmed");
      } catch (e) {
        setError(getErrorMessage(e));
        setStep("error");
      }
    },
    [isConnected, address, walletClient, publicClient],
  );

  const executeSell = useCallback(
    async (tokenAddress: string, tokenAmount: bigint, slippage: number) => {
      if (!isConnected || !address || !walletClient || !publicClient) {
        setError("Connect wallet first");
        return;
      }

      try {
        setError(null);
        setStep("approving");

        const routerAddr = ADDRESSES.redemptionRouter;

        const allowance = await publicClient.readContract({
          address: tokenAddress as `0x${string}`,
          abi: erc20Abi,
          functionName: "allowance",
          args: [address, routerAddr],
        });

        if ((allowance as bigint) < tokenAmount) {
          const approveTx = await walletClient.writeContract({
            address: tokenAddress as `0x${string}`,
            abi: erc20Abi,
            functionName: "approve",
            args: [routerAddr, maxUint256],
          });
          await publicClient.waitForTransactionReceipt({ hash: approveTx });
        }

        setStep("executing");

        const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);

        const slippageBps = slippageToBps(slippage);
        const { result: quotedUsdcOut } = await publicClient.simulateContract({
          address: routerAddr,
          abi: RedemptionRouterAbi,
          functionName: "sell",
          args: [
            tokenAddress as `0x${string}`,
            tokenAmount,
            0n,
            deadline,
          ],
          account: address,
        });
        const minUsdcOut =
          ((quotedUsdcOut as bigint) * BigInt(10_000 - slippageBps)) / 10_000n;

        const sellTx = await walletClient.writeContract({
          address: routerAddr,
          abi: RedemptionRouterAbi,
          functionName: "sell",
          args: [
            tokenAddress as `0x${string}`,
            tokenAmount,
            minUsdcOut,
            deadline,
          ],
        });

        await publicClient.waitForTransactionReceipt({ hash: sellTx });
        setTxHash(sellTx);
        setStep("confirmed");
      } catch (e) {
        setError(getErrorMessage(e));
        setStep("error");
      }
    },
    [isConnected, address, walletClient, publicClient],
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
    executeBuy,
    executeSell,
    reset,
  };
}
