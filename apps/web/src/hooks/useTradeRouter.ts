import { useState, useCallback } from "react";

import { createPublicClient, http, isAddress, maxUint256, parseUnits } from "viem";

import { usePrivyWalletClient } from "./usePrivyWalletClient";
import { useWallet } from "./useWallet";
import { hyperEVM } from "../config/chains";
import { erc20Abi, LaunchpadRouterAbi } from "../contracts/abis";
import { ADDRESSES, USDC_DECIMALS } from "../contracts/addresses";
import { type TxStep } from "../services/tradeRouter";
import { getErrorMessage } from "../utils/format";

const rpcUrl = import.meta.env.VITE_RPC_URL || "https://rpc.hyperliquid.xyz/evm";
const hyperEvmClient = createPublicClient({
  chain: hyperEVM,
  transport: http(rpcUrl),
});

function slippageToBps(slippage: number): number {
  const clamped = Number.isFinite(slippage) ? Math.max(slippage, 0) : 0;
  return Math.min(Math.floor(clamped * 100), 10_000);
}

export function useTradeRouter() {
  const { address, isConnected } = useWallet();
  const walletClient = usePrivyWalletClient();
  const [step, setStep] = useState<TxStep>("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const executeBuy = useCallback(
    async (tokenAddress: string, usdcAmount: number, slippage: number, referrer?: string) => {
      if (!isConnected || !address || !walletClient) {
        setError("Connect wallet first");
        return;
      }

      try {
        setError(null);
        setStep("approving");

        const usdcAmountWei = parseUnits(usdcAmount.toString(), USDC_DECIMALS);
        const routerAddr = ADDRESSES.launchpadRouter;

        const allowance = await hyperEvmClient.readContract({
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
          const approveReceipt = await hyperEvmClient.waitForTransactionReceipt({ hash: approveTx });
          if (approveReceipt.status === "reverted") {
            throw new Error("USDC approval transaction reverted");
          }
        }

        setStep("executing");

        const ZERO_ADDR = "0x0000000000000000000000000000000000000000" as const;
        const referrerAddr: `0x${string}` = referrer && isAddress(referrer) ? referrer : ZERO_ADDR;

        const slippageBps = slippageToBps(slippage);
        const { result: quotedTokensOut } =
          await hyperEvmClient.simulateContract({
            address: routerAddr,
            abi: LaunchpadRouterAbi,
            functionName: "buy",
            args: [
              tokenAddress as `0x${string}`,
              usdcAmountWei,
              0n,
              referrerAddr,
            ],
            account: address,
          });
        const minTokensOut =
          ((quotedTokensOut as bigint) * BigInt(10_000 - slippageBps)) /
          10_000n;

        const buyTx = await walletClient.writeContract({
          address: routerAddr,
          abi: LaunchpadRouterAbi,
          functionName: "buy",
          args: [
            tokenAddress as `0x${string}`,
            usdcAmountWei,
            minTokensOut,
            referrerAddr,
          ],
        });

        const buyReceipt = await hyperEvmClient.waitForTransactionReceipt({ hash: buyTx });
        if (buyReceipt.status === "reverted") {
          throw new Error("Buy transaction reverted on-chain");
        }
        setTxHash(buyTx);
        setStep("confirmed");
      } catch (e) {
        setError(getErrorMessage(e));
        setStep("error");
      }
    },
    [isConnected, address, walletClient],
  );

  const executeSell = useCallback(
    async (tokenAddress: string, tokenAmount: bigint, slippage: number) => {
      if (!isConnected || !address || !walletClient) {
        setError("Connect wallet first");
        return;
      }

      try {
        setError(null);
        setStep("approving");

        const routerAddr = ADDRESSES.launchpadRouter;

        const allowance = await hyperEvmClient.readContract({
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
          const approveReceipt = await hyperEvmClient.waitForTransactionReceipt({ hash: approveTx });
          if (approveReceipt.status === "reverted") {
            throw new Error("Token approval transaction reverted");
          }
        }

        setStep("executing");

        const slippageBps = slippageToBps(slippage);
        const { result: quotedUsdcOut } = await hyperEvmClient.simulateContract({
          address: routerAddr,
          abi: LaunchpadRouterAbi,
          functionName: "sell",
          args: [
            tokenAddress as `0x${string}`,
            tokenAmount,
            0n,
          ],
          account: address,
        });
        const minUsdcOut =
          ((quotedUsdcOut as bigint) * BigInt(10_000 - slippageBps)) / 10_000n;

        const sellTx = await walletClient.writeContract({
          address: routerAddr,
          abi: LaunchpadRouterAbi,
          functionName: "sell",
          args: [
            tokenAddress as `0x${string}`,
            tokenAmount,
            minUsdcOut,
          ],
        });

        const sellReceipt = await hyperEvmClient.waitForTransactionReceipt({ hash: sellTx });
        if (sellReceipt.status === "reverted") {
          throw new Error("Sell transaction reverted on-chain");
        }
        setTxHash(sellTx);
        setStep("confirmed");
      } catch (e) {
        setError(getErrorMessage(e));
        setStep("error");
      }
    },
    [isConnected, address, walletClient],
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
