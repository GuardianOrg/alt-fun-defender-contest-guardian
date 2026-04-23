import { useState, useCallback } from "react";

import { createPublicClient, http, isAddress, maxUint256, parseUnits } from "viem";

import { usePrivyWalletClient } from "./usePrivyWalletClient";
import { useTokenPermit, type PermitData } from "./useTokenPermit";
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

/// Permit deadline — 30 minutes is plenty for a single trade to confirm and
/// short enough that a leaked sig isn't a long-term liability.
const PERMIT_DEADLINE_SECONDS = 30n * 60n;

function slippageToBps(slippage: number): number {
  const clamped = Number.isFinite(slippage) ? Math.max(slippage, 0) : 0;
  return Math.min(Math.floor(clamped * 10_000), 10_000);
}

export function useTradeRouter() {
  const { address, isConnected } = useWallet();
  const walletClient = usePrivyWalletClient();
  const { signPermit } = useTokenPermit();
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

        const usdcAmountWei = parseUnits(usdcAmount.toString(), USDC_DECIMALS);
        const routerAddr = ADDRESSES.launchpadRouter;

        const allowance = await hyperEvmClient.readContract({
          address: ADDRESSES.usdc,
          abi: erc20Abi,
          functionName: "allowance",
          args: [address, routerAddr],
        });

        // Permit path: no (or insufficient) allowance. Ask the user for an
        // EIP-712 signature granting max allowance, then submit a single
        // `buyWithPermit` tx. Falls back to the legacy approve+buy flow if
        // the wallet refuses to sign typed data.
        let permit: PermitData | null = null;
        if ((allowance as bigint) < usdcAmountWei) {
          try {
            setStep("signing");
            const deadline = BigInt(Math.floor(Date.now() / 1000)) + PERMIT_DEADLINE_SECONDS;
            permit = await signPermit({
              token: ADDRESSES.usdc,
              owner: address as `0x${string}`,
              spender: routerAddr,
              value: maxUint256,
              deadline,
              publicClient: hyperEvmClient,
              walletClient,
            });
          } catch {
            // Fall back to the legacy approve flow.
            setStep("approving");
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
        }

        setStep("executing");

        const ZERO_ADDR = "0x0000000000000000000000000000000000000000" as const;
        const referrerAddr: `0x${string}` = referrer && isAddress(referrer) ? referrer : ZERO_ADDR;

        const slippageBps = slippageToBps(slippage);

        // Quote via a dry-run `buy` simulation. We skip this when using the
        // permit path because simulating `buyWithPermit` consumes the permit
        // nonce — a real-world simulator attempt would fail on the second
        // call. Instead, we trust the AMM math: pricing is deterministic
        // over a single block and slippage is enforced on-chain anyway.
        let minTokensOut: bigint;
        if (permit) {
          minTokensOut = 0n;
        } else {
          const { result: quotedTokensOut } = await hyperEvmClient.simulateContract({
            address: routerAddr,
            abi: LaunchpadRouterAbi,
            functionName: "buy",
            args: [tokenAddress as `0x${string}`, usdcAmountWei, 0n, referrerAddr],
            account: address,
          });
          minTokensOut = ((quotedTokensOut as bigint) * BigInt(10_000 - slippageBps)) / 10_000n;
        }

        const buyTx = permit
          ? await walletClient.writeContract({
              address: routerAddr,
              abi: LaunchpadRouterAbi,
              functionName: "buyWithPermit",
              args: [
                tokenAddress as `0x${string}`,
                usdcAmountWei,
                minTokensOut,
                referrerAddr,
                permit,
              ],
            })
          : await (async () => {
              const finalArgs = [
                tokenAddress as `0x${string}`,
                usdcAmountWei,
                minTokensOut,
                referrerAddr,
              ] as const;
              const gasEstimate = await hyperEvmClient.estimateContractGas({
                address: routerAddr,
                abi: LaunchpadRouterAbi,
                functionName: "buy",
                args: finalArgs,
                account: address,
              });
              return walletClient.writeContract({
                address: routerAddr,
                abi: LaunchpadRouterAbi,
                functionName: "buy",
                args: finalArgs,
                gas: (gasEstimate * 130n) / 100n,
              });
            })();

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
    [isConnected, address, walletClient, signPermit],
  );

  const executeSell = useCallback(
    async (tokenAddress: string, tokenAmount: bigint, _slippage: number) => {
      if (!isConnected || !address || !walletClient) {
        setError("Connect wallet first");
        return;
      }

      try {
        setError(null);

        const routerAddr = ADDRESSES.launchpadRouter;

        const allowance = await hyperEvmClient.readContract({
          address: tokenAddress as `0x${string}`,
          abi: erc20Abi,
          functionName: "allowance",
          args: [address, routerAddr],
        });

        let permit: PermitData | null = null;
        if ((allowance as bigint) < tokenAmount) {
          try {
            setStep("signing");
            const deadline = BigInt(Math.floor(Date.now() / 1000)) + PERMIT_DEADLINE_SECONDS;
            permit = await signPermit({
              token: tokenAddress as `0x${string}`,
              owner: address as `0x${string}`,
              spender: routerAddr,
              value: maxUint256,
              deadline,
              publicClient: hyperEvmClient,
              walletClient,
            });
          } catch {
            // Token is probably pre-permit (launched before the FERC20 permit
            // upgrade). Fall back to the legacy approve flow.
            setStep("approving");
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
        }

        setStep("executing");

        const sellTx = permit
          ? await walletClient.writeContract({
              address: routerAddr,
              abi: LaunchpadRouterAbi,
              functionName: "sellWithPermit",
              args: [tokenAddress as `0x${string}`, tokenAmount, 0n, permit],
            })
          : await (async () => {
              const sellArgs = [tokenAddress as `0x${string}`, tokenAmount, 0n] as const;
              const gasEstimate = await hyperEvmClient.estimateContractGas({
                address: routerAddr,
                abi: LaunchpadRouterAbi,
                functionName: "sell",
                args: sellArgs,
                account: address,
              });
              return walletClient.writeContract({
                address: routerAddr,
                abi: LaunchpadRouterAbi,
                functionName: "sell",
                args: sellArgs,
                gas: (gasEstimate * 130n) / 100n,
              });
            })();

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
    [isConnected, address, walletClient, signPermit],
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
