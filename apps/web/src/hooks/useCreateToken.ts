import { useCallback, useRef, useState } from "react";

import { findLT, MAX_TOKEN_DESCRIPTION_LENGTH, MAX_TOKEN_IMAGE_URL_LENGTH, MAX_TOKEN_URL_LENGTH, MIN_USDC_BUY_AMOUNT, sanitizeTelegramHandle, sanitizeTwitterHandle, sanitizeWebsiteUrl, utf8ByteLength } from "@launchpad/shared";
import { createPublicClient, http, maxUint256, parseEventLogs, parseUnits, type Address, type Hex } from "viem";

import { usePrivyWalletClient } from "./usePrivyWalletClient";
import { useTokenPermit, type PermitData } from "./useTokenPermit";
import { useWallet } from "./useWallet";
import { hyperEVM } from "../config/chains";
import { erc20Abi, ZapAbi } from "../contracts/abis";
import { ADDRESSES, USDC_DECIMALS } from "../contracts/addresses";
import { fetchLeveragedTokens, registerTokenApi, uploadImage } from "../services/api";
import { getErrorMessage } from "../utils/format";
import { resolveLaunchSalt } from "../utils/saltCollisionRecovery";

import type { LaunchStep } from "../services/tradeRouter";
import type { CreateTokenParams } from "../services/types";

const rpcUrl = import.meta.env.VITE_RPC_URL || "https://rpc.hyperliquid.xyz/evm";
const hyperEvmClient = createPublicClient({
  chain: hyperEVM,
  transport: http(rpcUrl, { batch: true }),
});

async function fetchLTs() {
  return fetchLeveragedTokens();
}

// Same permit deadline window as the trade router.
const PERMIT_DEADLINE_SECONDS = 30n * 60n;

export function useCreateToken() {
  const { address, isConnected } = useWallet();
  const walletClient = usePrivyWalletClient();
  const { signPermit } = useTokenPermit();
  const [step, setStep] = useState<LaunchStep>("idle");
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [tokenAddress, setTokenAddress] = useState<string | null>(null);
  // Synchronous guard for double-clicks before `step` can disable the button.
  const inFlightRef = useRef(false);

  const create = useCallback(
    async (
      params: CreateTokenParams,
      userSalt: Hex,
      predictedAddress: Address,
      // Re-mines when the predicted CREATE2 address is already occupied.
      mineFreshSalt?: () => Promise<{ salt: Hex; address: Address }>,
    ) => {
      if (!isConnected || !address || !walletClient) {
        setError("Connect wallet first");
        return;
      }

      if (inFlightRef.current) {
        // Drop duplicate clicks during upload/sign/deploy.
        return;
      }
      inFlightRef.current = true;

      try {
        setError(null);
        setWarning(null);

        // Mirror `Zap.MIN_SEED_USDC` before any wallet popup.
        if (params.seedBuyUsd < MIN_USDC_BUY_AMOUNT) {
          throw new Error(
            `Seed buy must be at least $${MIN_USDC_BUY_AMOUNT} USDC (anti-snipe floor).`,
          );
        }

        const lts = await fetchLTs();
        const isLong = params.direction === "long";
        const lt = findLT(lts, params.underlying, params.leverage, isLong);
        if (!lt) {
          throw new Error(
            `No LT found for ${params.underlying} ${params.leverage}× ${params.direction}`,
          );
        }
        // Creation includes a seed buy, so paused LT minting must block launch.
        const liveLt = lts.find(
          (entry) => entry.address.toLowerCase() === lt.address.toLowerCase(),
        );
        if (liveLt?.mintPaused) {
          throw new Error(
            `${params.underlying} ${params.leverage}× ${params.direction} minting is currently paused by BounceTech. Pick a different pair or try again once minting resumes.`,
          );
        }

        // Mirror Bonding.launch length caps before wallet popup.
        if (params.description && utf8ByteLength(params.description) > MAX_TOKEN_DESCRIPTION_LENGTH) {
          throw new Error(`Description is too long (max ${MAX_TOKEN_DESCRIPTION_LENGTH} bytes)`);
        }
        // Store canonical social values on-chain; API sanitises again on registration.
        const rawSocials = params.socialLinks ?? [];
        const socials: [string, string, string] = [
          sanitizeTwitterHandle(rawSocials[0] ?? ""),
          sanitizeTelegramHandle(rawSocials[1] ?? ""),
          sanitizeWebsiteUrl(rawSocials[2] ?? ""),
        ];
        for (const value of socials) {
          if (value && utf8ByteLength(value) > MAX_TOKEN_URL_LENGTH) {
            throw new Error(`Social link is too long (max ${MAX_TOKEN_URL_LENGTH} bytes)`);
          }
        }

        // Upload and moderate before launch so unapproved images never reach on-chain metadata.
        let imageUrl = "";
        if (params.imageFile) {
          setStep("uploading");
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
          if (utf8ByteLength(imageUrl) > MAX_TOKEN_IMAGE_URL_LENGTH) {
            throw new Error(`Image URL is too long (max ${MAX_TOKEN_IMAGE_URL_LENGTH} bytes)`);
          }
        }

        // Recover from cached-salt CREATE2 collisions before any wallet popup.
        const { salt: activeSalt } = await resolveLaunchSalt({
          initialSalt: userSalt,
          initialPredicted: predictedAddress,
          getBytecode: (address) =>
            hyperEvmClient.getBytecode({ address }) as Promise<Hex | undefined>,
          mineFreshSalt,
        });

        // Prefer permit path; fall back to approve+create if typed-data signing fails.
        let permit: PermitData | null = null;
        if (params.seedBuyUsd > 0) {
          const usdcAmount = parseUnits(
            params.seedBuyUsd.toFixed(USDC_DECIMALS),
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

        // `activeSalt` may differ from the initial salt after collision recovery.
        const salt: Hex = activeSalt;
        const launchParams = {
          name: params.name,
          ticker: params.ticker,
          description: params.description,
          // Registration later verifies this R2 URL against the on-chain source of truth.
          image: imageUrl,
          urls: socials,
          ltAddress: lt.address,
          salt,
        };

        const seedUsdcAmount = params.seedBuyUsd > 0
          ? parseUnits(params.seedBuyUsd.toFixed(USDC_DECIMALS), USDC_DECIMALS)
          : 0n;

        // Estimate + bump both paths to reduce out-of-gas surprises.
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

        // Await registration when possible; cron backfill covers transient failures.
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
      } finally {
        inFlightRef.current = false;
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
