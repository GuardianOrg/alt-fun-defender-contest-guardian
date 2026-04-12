import { useState, useCallback } from "react";

import {
  BOUNCE_INDEXING_API,
  buildTokenCreationMessage,
  findLT,
  type LiveLeveragedToken,
} from "@launchpad/shared";
import { getAddress, maxUint256, parseEventLogs, parseUnits } from "viem";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";

import { erc20Abi, RedemptionRouterAbi } from "../contracts/abis";
import { ADDRESSES, USDC_DECIMALS } from "../contracts/addresses";
import { createTokenApi, uploadImage } from "../services/api";
import { getErrorMessage } from "../utils/format";

import type { LaunchStep } from "../services/tradeRouter";
import type { CreateTokenParams } from "../services/types";

async function fetchLTs(): Promise<LiveLeveragedToken[]> {
  const res = await fetch(`${BOUNCE_INDEXING_API}/leveraged-tokens`);
  return (await res.json()) as LiveLeveragedToken[];
}

export function useCreateToken() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const [step, setStep] = useState<LaunchStep>("idle");
  const [error, setError] = useState<string | null>(null);
  const [tokenAddress, setTokenAddress] = useState<string | null>(null);

  const create = useCallback(
    async (params: CreateTokenParams) => {
      if (!isConnected || !address || !walletClient || !publicClient) {
        setError("Connect wallet first");
        return;
      }

      try {
        setError(null);
        setStep("approving");

        const lts = await fetchLTs();
        const isLong = params.direction === "long";
        const lt = findLT(lts, params.underlying, params.leverage, isLong);
        if (!lt) {
          throw new Error(
            `No LT found for ${params.underlying} ${params.leverage}× ${params.direction}`,
          );
        }

        if (params.seedBuyUsd > 0) {
          const usdcAmount = parseUnits(
            params.seedBuyUsd.toString(),
            USDC_DECIMALS,
          );
          const allowance = (await publicClient.readContract({
            address: ADDRESSES.usdc,
            abi: erc20Abi,
            functionName: "allowance",
            args: [address, ADDRESSES.redemptionRouter],
          })) as bigint;

          if (allowance < usdcAmount) {
            const approveTx = await walletClient.writeContract({
              address: ADDRESSES.usdc,
              abi: erc20Abi,
              functionName: "approve",
              args: [ADDRESSES.redemptionRouter, maxUint256],
            });
            await publicClient.waitForTransactionReceipt({ hash: approveTx });
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

        const tx = await walletClient.writeContract({
          address: ADDRESSES.redemptionRouter,
          abi: RedemptionRouterAbi,
          functionName: "createToken",
          args: [launchParams, seedUsdcAmount],
        });

        const receipt = await publicClient.waitForTransactionReceipt({
          hash: tx,
        });

        const tokenCreatedEvents = parseEventLogs({
          abi: RedemptionRouterAbi,
          eventName: "TokenCreated",
          logs: receipt.logs,
          strict: false,
        });
        const newTokenAddr =
          (tokenCreatedEvents[0]?.args as { token?: `0x${string}` })?.token ??
          null;

        let imageUrl = "";
        if (params.imageFile) {
          try {
            const uploaded = await uploadImage(params.imageFile);
            imageUrl = uploaded.url;
          } catch {
            /* image upload is non-critical */
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
              ltPair: lt.symbol,
              ltDirection: ltDir,
              leverage: params.leverage,
              twitterUrl: socials[0] ?? "",
              telegramUrl: socials[1] ?? "",
              websiteUrl: socials[2] ?? "",
              creator: normalizedCreator,
            };
            const message = buildTokenCreationMessage(apiPayload);
            const signature = await walletClient.signMessage({ message });
            await createTokenApi({ ...apiPayload, signature });
          } catch {
            /* API registration is non-critical for on-chain flow */
          }
          setTokenAddress(newTokenAddr);
        }

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
    setError(null);
    setTokenAddress(null);
  }, []);

  return { step, error, tokenAddress, create, reset };
}
