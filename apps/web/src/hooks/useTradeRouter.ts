import { useState, useCallback } from "react";

import { createPublicClient, http, isAddress, maxUint256, parseUnits } from "viem";

import { usePrivyWalletClient } from "./usePrivyWalletClient";
import { useTokenPermit, type PermitData } from "./useTokenPermit";
import { useWallet } from "./useWallet";
import { hyperEVM } from "../config/chains";
import { erc20Abi, ZapAbi } from "../contracts/abis";
import { ADDRESSES, USDC_DECIMALS } from "../contracts/addresses";
import { type TxStep } from "../services/tradeRouter";
import { getErrorMessage } from "../utils/format";

const rpcUrl = import.meta.env.VITE_RPC_URL || "https://rpc.hyperliquid.xyz/evm";
// `batch: true` mirrors `config/wagmi.ts`. `executeBuy` / `executeSell`
// each fan out `readContract(allowance) → simulateContract →
// estimateContractGas` in the same tick on the permit path; batching
// collapses the two pre-write reads into one HTTP POST.
const hyperEvmClient = createPublicClient({
  chain: hyperEVM,
  transport: http(rpcUrl, { batch: true }),
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

        const usdcAmountWei = parseUnits(usdcAmount.toFixed(USDC_DECIMALS), USDC_DECIMALS);
        const routerAddr = ADDRESSES.zap;

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

        // Quote via a dry-run simulation. `eth_call` is stateless on the node
        // side, so simulating the permit path doesn't consume the signature's
        // nonce — it's safe to run on both paths and get accurate slippage.
        const { result: quotedTokensOut } = permit
          ? await hyperEvmClient.simulateContract({
              address: routerAddr,
              abi: ZapAbi,
              functionName: "buyWithPermit",
              args: [tokenAddress as `0x${string}`, usdcAmountWei, 0n, referrerAddr, permit],
              account: address,
            })
          : await hyperEvmClient.simulateContract({
              address: routerAddr,
              abi: ZapAbi,
              functionName: "buy",
              args: [tokenAddress as `0x${string}`, usdcAmountWei, 0n, referrerAddr],
              account: address,
            });
        const minTokensOut = ((quotedTokensOut as bigint) * BigInt(10_000 - slippageBps)) / 10_000n;

        const buyTx = permit
          ? await (async () => {
              const permitArgs = [
                tokenAddress as `0x${string}`,
                usdcAmountWei,
                minTokensOut,
                referrerAddr,
                permit,
              ] as const;
              const gasEstimate = await hyperEvmClient.estimateContractGas({
                address: routerAddr,
                abi: ZapAbi,
                functionName: "buyWithPermit",
                args: permitArgs,
                account: address,
              });
              return walletClient.writeContract({
                address: routerAddr,
                abi: ZapAbi,
                functionName: "buyWithPermit",
                args: permitArgs,
                gas: (gasEstimate * 130n) / 100n,
              });
            })()
          : await (async () => {
              const finalArgs = [
                tokenAddress as `0x${string}`,
                usdcAmountWei,
                minTokensOut,
                referrerAddr,
              ] as const;
              const gasEstimate = await hyperEvmClient.estimateContractGas({
                address: routerAddr,
                abi: ZapAbi,
                functionName: "buy",
                args: finalArgs,
                account: address,
              });
              return walletClient.writeContract({
                address: routerAddr,
                abi: ZapAbi,
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
    async (tokenAddress: string, tokenAmount: bigint, slippage: number) => {
      if (!isConnected || !address || !walletClient) {
        setError("Connect wallet first");
        return;
      }

      try {
        setError(null);

        const routerAddr = ADDRESSES.zap;

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
            // Token is probably pre-permit (launched before the Token permit
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

        const slippageBps = slippageToBps(slippage);

        // Quote via a dry-run simulation to derive minUsdcOut. Without this
        // every sell would land with minUsdcOut=0 and be fully sandwichable.
        // simulating the permit path doesn't consume the signature's nonce
        // (eth_call is stateless), so it's safe on both branches.
        const { result: quotedUsdcOut } = permit
          ? await hyperEvmClient.simulateContract({
              address: routerAddr,
              abi: ZapAbi,
              functionName: "sellWithPermit",
              args: [tokenAddress as `0x${string}`, tokenAmount, 0n, permit],
              account: address,
            })
          : await hyperEvmClient.simulateContract({
              address: routerAddr,
              abi: ZapAbi,
              functionName: "sell",
              args: [tokenAddress as `0x${string}`, tokenAmount, 0n],
              account: address,
            });
        // Floor at 1 wei when the quote is non-zero but slippage rounds the
        // bound to zero — passing 0 would re-open the unconstrained-execution
        // window this fix exists to close.
        const quotedOut = quotedUsdcOut as bigint;
        const computedMinUsdcOut = (quotedOut * BigInt(10_000 - slippageBps)) / 10_000n;
        const minUsdcOut =
          quotedOut > 0n && slippageBps < 10_000 && computedMinUsdcOut === 0n ? 1n : computedMinUsdcOut;

        const sellTx = permit
          ? await (async () => {
              const permitArgs = [tokenAddress as `0x${string}`, tokenAmount, minUsdcOut, permit] as const;
              const gasEstimate = await hyperEvmClient.estimateContractGas({
                address: routerAddr,
                abi: ZapAbi,
                functionName: "sellWithPermit",
                args: permitArgs,
                account: address,
              });
              return walletClient.writeContract({
                address: routerAddr,
                abi: ZapAbi,
                functionName: "sellWithPermit",
                args: permitArgs,
                gas: (gasEstimate * 130n) / 100n,
              });
            })()
          : await (async () => {
              const sellArgs = [tokenAddress as `0x${string}`, tokenAmount, minUsdcOut] as const;
              const gasEstimate = await hyperEvmClient.estimateContractGas({
                address: routerAddr,
                abi: ZapAbi,
                functionName: "sell",
                args: sellArgs,
                account: address,
              });
              return walletClient.writeContract({
                address: routerAddr,
                abi: ZapAbi,
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
