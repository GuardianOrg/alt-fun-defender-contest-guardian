import { useState, useCallback } from "react";

import {
  buildTokenCreationMessage,
  findLT,
} from "@launchpad/shared";
import { createPublicClient, getAddress, http, maxUint256, parseEventLogs, parseUnits } from "viem";

import { usePrivyWalletClient } from "./usePrivyWalletClient";
import { useTokenPermit, type PermitData } from "./useTokenPermit";
import { useWallet } from "./useWallet";
import { hyperEVM } from "../config/chains";
import { erc20Abi, LaunchpadRouterAbi } from "../contracts/abis";
import { ADDRESSES, USDC_DECIMALS } from "../contracts/addresses";
import { createTokenApi, fetchLeveragedTokens, uploadImage } from "../services/api";
import { getErrorMessage } from "../utils/format";

import type { LaunchStep } from "../services/tradeRouter";
import type { CreateTokenParams } from "../services/types";

const rpcUrl = import.meta.env.VITE_RPC_URL || "https://rpc.hyperliquid.xyz/evm";
const hyperEvmClient = createPublicClient({
  chain: hyperEVM,
  transport: http(rpcUrl),
});

async function fetchLTs() {
  return fetchLeveragedTokens();
}

/// See `useTradeRouter` — same deadline window for the create-with-seed-buy path.
const PERMIT_DEADLINE_SECONDS = 30n * 60n;

export function useCreateToken() {
  const { address, isConnected } = useWallet();
  const walletClient = usePrivyWalletClient();
  const { signPermit } = useTokenPermit();
  const [step, setStep] = useState<LaunchStep>("idle");
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [tokenAddress, setTokenAddress] = useState<string | null>(null);

  const create = useCallback(
    async (params: CreateTokenParams) => {
      if (!isConnected || !address || !walletClient) {
        setError("Connect wallet first");
        return;
      }

      try {
        setError(null);
        setWarning(null);

        const lts = await fetchLTs();
        const isLong = params.direction === "long";
        const lt = findLT(lts, params.underlying, params.leverage, isLong);
        if (!lt) {
          throw new Error(
            `No LT found for ${params.underlying} ${params.leverage}× ${params.direction}`,
          );
        }

        // Prefer `createTokenWithPermit` (1 tx) when a seed buy is needed and
        // USDC isn't already approved. Falls back to approve+createToken if
        // the wallet refuses to sign typed data.
        let permit: PermitData | null = null;
        if (params.seedBuyUsd > 0) {
          const usdcAmount = parseUnits(
            params.seedBuyUsd.toString(),
            USDC_DECIMALS,
          );
          const allowance = (await hyperEvmClient.readContract({
            address: ADDRESSES.usdc,
            abi: erc20Abi,
            functionName: "allowance",
            args: [address, ADDRESSES.launchpadRouter],
          })) as bigint;

          if (allowance < usdcAmount) {
            try {
              setStep("signing");
              const deadline = BigInt(Math.floor(Date.now() / 1000)) + PERMIT_DEADLINE_SECONDS;
              permit = await signPermit({
                token: ADDRESSES.usdc,
                owner: address as `0x${string}`,
                spender: ADDRESSES.launchpadRouter,
                value: maxUint256,
                deadline,
                publicClient: hyperEvmClient,
                walletClient,
              });
            } catch {
              setStep("approving");
              const approveTx = await walletClient.writeContract({
                address: ADDRESSES.usdc,
                abi: erc20Abi,
                functionName: "approve",
                args: [ADDRESSES.launchpadRouter, maxUint256],
              });
              const approveReceipt = await hyperEvmClient.waitForTransactionReceipt({ hash: approveTx });
              if (approveReceipt.status === "reverted") {
                throw new Error("USDC approval transaction reverted");
              }
            }
          }
        }

        setStep("deploying");

        const socials = params.socialLinks ?? [];
        const launchParams = {
          name: params.name,
          ticker: params.ticker,
          description: params.description,
          image: "",
          urls: [
            socials[0] ?? "",
            socials[1] ?? "",
            socials[2] ?? "",
            socials[3] ?? "",
          ] as [string, string, string, string],
          ltAddress: lt.address,
          purchaseAmount: 0n,
        };

        const seedUsdcAmount = params.seedBuyUsd > 0
          ? parseUnits(params.seedBuyUsd.toString(), USDC_DECIMALS)
          : 0n;

        // `eth_estimateGas` is stateless on the node, so the permit nonce
        // isn't actually consumed when estimating `createTokenWithPermit` —
        // we estimate + bump on both paths to reduce out-of-gas surprises.
        const tx = permit
          ? await (async () => {
              const gasEstimate = await hyperEvmClient.estimateContractGas({
                address: ADDRESSES.launchpadRouter,
                abi: LaunchpadRouterAbi,
                functionName: "createTokenWithPermit",
                args: [launchParams, seedUsdcAmount, permit],
                account: address,
              });
              const gasLimit = (gasEstimate * 130n) / 100n;
              return walletClient.writeContract({
                address: ADDRESSES.launchpadRouter,
                abi: LaunchpadRouterAbi,
                functionName: "createTokenWithPermit",
                args: [launchParams, seedUsdcAmount, permit],
                gas: gasLimit,
              });
            })()
          : await (async () => {
              const gasEstimate = await hyperEvmClient.estimateContractGas({
                address: ADDRESSES.launchpadRouter,
                abi: LaunchpadRouterAbi,
                functionName: "createToken",
                args: [launchParams, seedUsdcAmount],
                account: address,
              });
              const gasLimit = (gasEstimate * 130n) / 100n;
              return walletClient.writeContract({
                address: ADDRESSES.launchpadRouter,
                abi: LaunchpadRouterAbi,
                functionName: "createToken",
                args: [launchParams, seedUsdcAmount],
                gas: gasLimit,
              });
            })();

        const receipt = await hyperEvmClient.waitForTransactionReceipt({
          hash: tx,
        });

        if (receipt.status === "reverted") {
          throw new Error("Token creation transaction reverted on-chain");
        }

        const tokenCreatedEvents = parseEventLogs({
          abi: LaunchpadRouterAbi,
          eventName: "TokenCreated",
          logs: receipt.logs,
          strict: false,
        });
        const newTokenAddr =
          (tokenCreatedEvents[0]?.args as { token?: `0x${string}` })?.token ??
          null;

        const warnings: string[] = [];

        if (newTokenAddr) {
          setTokenAddress(newTokenAddr);
        }

        let imageUrl = "";
        if (params.imageFile) {
          try {
            const uploaded = await uploadImage(params.imageFile);
            imageUrl = uploaded.url;
          } catch (uploadErr) {
            const detail = uploadErr instanceof Error ? uploadErr.message : "unknown error";
            warnings.push(`Image upload failed (${detail}) — your token was created but has no image.`);
          }
        }

        if (newTokenAddr) {
          try {
            const ltDir = isLong ? "long" : "short";
            const normalizedToken = getAddress(newTokenAddr);
            const normalizedCreator = getAddress(address);
            const apiPayload = {
              address: normalizedToken,
              name: params.name,
              ticker: params.ticker,
              description: params.description ?? "",
              imageUrl,
              ltPair: lt.address,
              ltDirection: ltDir,
              leverage: params.leverage,
              underlying: params.underlying,
              twitterUrl: socials[0] ?? "",
              telegramUrl: socials[1] ?? "",
              websiteUrl: socials[2] ?? "",
              creator: normalizedCreator,
            };
            const message = buildTokenCreationMessage(apiPayload);
            const signature = await walletClient.signMessage({ message });
            await createTokenApi({ ...apiPayload, signature });
          } catch {
            warnings.push("Token metadata registration failed — your token was created on-chain but metadata (image, description, social links) was not saved. Visit your token page to retry.");
          }
        }

        if (warnings.length > 0) {
          setWarning(warnings.join(" "));
        }
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
    setError(null);
    setWarning(null);
    setTokenAddress(null);
  }, []);

  return { step, error, warning, tokenAddress, create, reset };
}
