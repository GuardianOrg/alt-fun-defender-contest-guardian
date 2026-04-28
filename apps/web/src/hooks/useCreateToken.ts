import { useState, useCallback } from "react";

import { findLT } from "@launchpad/shared";
import { createPublicClient, http, maxUint256, parseEventLogs, parseUnits, type Hex } from "viem";

import { usePrivyWalletClient } from "./usePrivyWalletClient";
import { useTokenPermit, type PermitData } from "./useTokenPermit";
import { useWallet } from "./useWallet";
import { hyperEVM } from "../config/chains";
import { erc20Abi, ZapAbi } from "../contracts/abis";
import { ADDRESSES, USDC_DECIMALS } from "../contracts/addresses";
import { fetchLeveragedTokens, registerTokenApi, uploadImage } from "../services/api";
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
    async (params: CreateTokenParams, userSalt: Hex) => {
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

        // Upload the image BEFORE the launch tx so we can stamp the
        // resulting URL into `LaunchParams.image` on-chain. The API
        // performs content moderation here and returns 4xx if the image
        // is rejected, which keeps the user out of the wallet popup
        // entirely. Failures are surfaced as a warning rather than
        // aborting the launch — a missing image is acceptable; an
        // unmoderated one would silently bypass our pipeline.
        let imageUrl = "";
        if (params.imageFile) {
          try {
            const uploaded = await uploadImage(params.imageFile);
            imageUrl = uploaded.url;
          } catch (uploadErr) {
            const detail = uploadErr instanceof Error ? uploadErr.message : "unknown error";
            throw new Error(
              `Image upload failed (${detail}). Try a different image or remove it to continue.`,
              { cause: uploadErr },
            );
          }
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
            args: [address, ADDRESSES.zap],
          })) as bigint;

          if (allowance < usdcAmount) {
            try {
              setStep("signing");
              const deadline = BigInt(Math.floor(Date.now() / 1000)) + PERMIT_DEADLINE_SECONDS;
              permit = await signPermit({
                token: ADDRESSES.usdc,
                owner: address as `0x${string}`,
                spender: ADDRESSES.zap,
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
                args: [ADDRESSES.zap, maxUint256],
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
        // Vanity salt fed by the worker pool in `useVanityAddress`. The
        // contract enforces the suffix on-chain (`Bonding.NotVanityAddress`),
        // so we hard-require a mined salt here — the caller (`CreateView`)
        // awaits `vanity.ensureSalt()` before calling us. Passing a random
        // salt would just revert.
        const salt: Hex = userSalt;
        const launchParams = {
          name: params.name,
          ticker: params.ticker,
          description: params.description,
          // The on-chain `image` field is the source of truth for the
          // home-page image — the API's moderation gateway returns the URL
          // that lives in our R2 bucket, and the registration endpoint
          // refuses anything that doesn't match this prefix.
          image: imageUrl,
          urls: [
            socials[0] ?? "",
            socials[1] ?? "",
            socials[2] ?? "",
            socials[3] ?? "",
          ] as [string, string, string, string],
          ltAddress: lt.address,
          salt,
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
                address: ADDRESSES.zap,
                abi: ZapAbi,
                functionName: "createTokenWithPermit",
                args: [launchParams, seedUsdcAmount, permit],
                account: address,
              });
              const gasLimit = (gasEstimate * 130n) / 100n;
              return walletClient.writeContract({
                address: ADDRESSES.zap,
                abi: ZapAbi,
                functionName: "createTokenWithPermit",
                args: [launchParams, seedUsdcAmount, permit],
                gas: gasLimit,
              });
            })()
          : await (async () => {
              const gasEstimate = await hyperEvmClient.estimateContractGas({
                address: ADDRESSES.zap,
                abi: ZapAbi,
                functionName: "createToken",
                args: [launchParams, seedUsdcAmount],
                account: address,
              });
              const gasLimit = (gasEstimate * 130n) / 100n;
              return walletClient.writeContract({
                address: ADDRESSES.zap,
                abi: ZapAbi,
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
          abi: ZapAbi,
          eventName: "TokenCreated",
          logs: receipt.logs,
          strict: false,
        });
        const newTokenAddr =
          (tokenCreatedEvents[0]?.args as { token?: `0x${string}` })?.token ??
          null;

        if (newTokenAddr) {
          setTokenAddress(newTokenAddr);
        }

        // Off-chain registration. The API reads the freshly-emitted
        // `TokenInfo` directly from chain — no signature needed because
        // anyone calling this for `newTokenAddr` would produce an
        // identical row. We `await` so the spinner stays up until the row
        // is queryable; if it errors, the cron backfill catches up within
        // ~60s, so the warning copy points the user at "we'll keep trying"
        // rather than "you must retry manually".
        if (newTokenAddr) {
          try {
            await registerTokenApi(newTokenAddr);
          } catch (registerErr) {
            const detail = registerErr instanceof Error ? registerErr.message : "unknown error";
            setWarning(
              `Token launched on-chain but indexing is delayed (${detail}). It should appear within a minute.`,
            );
          }
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
