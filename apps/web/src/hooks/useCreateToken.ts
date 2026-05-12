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
  /// Re-entry guard against double-clicks on the Launch button. Without
  /// this, the multi-second `uploadImage` call (OpenAI moderation +
  /// R2) ran while `step` was still `"idle"`, so the button stayed
  /// enabled and a second click would fire a fully parallel
  /// `Zap.createToken` flow against the same `(creator, name, ticker,
  /// salt)` quartet — first tx deploys the clone, second reverts deep
  /// inside `Clones.cloneDeterministic` with `FailedDeployment()`
  /// (`0xb06ebf3d`). The ref is the source of truth (synchronous, beats
  /// the async `setStep`); CSS-level disabling via the `"uploading"`
  /// step is the visible companion. Both layers must agree.
  const inFlightRef = useRef(false);

  const create = useCallback(
    async (
      params: CreateTokenParams,
      userSalt: Hex,
      predictedAddress: Address,
      onSaltCollision?: () => void,
    ) => {
      if (!isConnected || !address || !walletClient) {
        setError("Connect wallet first");
        return;
      }

      if (inFlightRef.current) {
        // Another launch is mid-flight (typically the user double-
        // clicked during the upload window). Drop the duplicate
        // silently — surfacing an error here would just confuse the
        // user mid-launch.
        return;
      }
      inFlightRef.current = true;

      try {
        setError(null);
        setWarning(null);

        // Mirrors `Zap.MIN_SEED_USDC` on-chain. The contract reverts with
        // `BelowMinSeed` for any smaller seed; surfacing the floor here
        // means we never put the user through wallet popups for a tx that
        // can't land. UI also disables the Launch button — this is a
        // belt-and-braces.
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
        // Token creation is gated by `Zap.MIN_SEED_USDC` (mandatory seed
        // buy ≥ $20), so launching against a paused LT would revert when
        // `Zap._executeBuy` tries to mint. Block the launch up-front with
        // a clear message instead of letting the user discover the revert
        // after vanity-mining + signing the permit. The UI mirrors this
        // with a disabled Launch button so the path here is belt-and-
        // braces — see `CreateView` for the user-facing surface.
        const liveLt = lts.find(
          (entry) => entry.address.toLowerCase() === lt.address.toLowerCase(),
        );
        if (liveLt?.mintPaused) {
          throw new Error(
            `${params.underlying} ${params.leverage}× ${params.direction} minting is currently paused by BounceTech. Pick a different pair or try again once minting resumes.`,
          );
        }

        // Pre-flight length checks — mirrors Bonding.launch's on-chain caps.
        // Gives a clear UI error before the wallet popup rather than a revert.
        if (params.description && utf8ByteLength(params.description) > MAX_TOKEN_DESCRIPTION_LENGTH) {
          throw new Error(`Description is too long (max ${MAX_TOKEN_DESCRIPTION_LENGTH} bytes)`);
        }
        // Normalise the three social-link slots before they hit the chain.
        // The API will sanitise these again on registration (issue #400),
        // but doing it here too means we never spend on-chain bytes on
        // unsafe / unparseable values, and the user's launch tx stores
        // exactly what the home-page row will end up holding (handle for
        // X/TG, canonical URL for website).
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

        // Upload the image BEFORE the launch tx so we can stamp the
        // resulting URL into `LaunchParams.image` on-chain. The API
        // performs content moderation here and returns 4xx if the image
        // is rejected, which keeps the user out of the wallet popup
        // entirely. Upload failures abort the launch — an unmoderated
        // image must never reach the on-chain field, so the user must
        // remove or change the image to continue.
        //
        // `setStep("uploading")` flips the create button into its
        // busy state for the duration of the OpenAI moderation +
        // R2 write (typically 1-5s). Without this the button stayed
        // visually idle and a second click during the upload window
        // would fire a parallel launch tx that collides on CREATE2
        // (issue: `0xb06ebf3d FailedDeployment`). The `inFlightRef`
        // re-entry guard above is the synchronous belt-and-braces
        // for the same race.
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

        // Pre-flight: reject the launch before any wallet popup if the
        // predicted CREATE2 clone address already has bytecode at it
        // (i.e. a token with this exact `(creator, name, ticker,
        // userSalt)` quartet has already been deployed). The on-chain
        // path would otherwise revert deep inside
        // `Clones.cloneDeterministic` with `FailedDeployment()`
        // (`0xb06ebf3d`), an opaque error to the user.
        //
        // The miner caches the salt in `localStorage` keyed by
        // `(creator, impl, name, ticker)`, so the obvious cause is the
        // user previously launched a token with the same name + ticker
        // (perhaps in an earlier session they've forgotten about). We
        // hand control back to `useVanityAddress` via
        // `onSaltCollision` so it can drop the stale cache row and
        // restart mining — without that callback the next retry would
        // pull the same colliding salt out of the cache and revert
        // again.
        const existingCode = await hyperEvmClient.getBytecode({
          address: predictedAddress,
        });
        if (existingCode && existingCode !== "0x") {
          if (onSaltCollision) onSaltCollision();
          throw new Error(
            `A token with this name and ticker already exists for your wallet. ` +
              `Change the name or ticker, or click Launch again to mine a new ` +
              `vanity address.`,
          );
        }

        // Prefer `createTokenWithPermit` (1 tx) when a seed buy is needed and
        // USDC isn't already approved. Falls back to approve+createToken if
        // the wallet refuses to sign typed data.
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

        // `socials` is declared above in the pre-flight validation block.
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
          urls: socials,
          ltAddress: lt.address,
          salt,
        };

        const seedUsdcAmount = params.seedBuyUsd > 0
          ? parseUnits(params.seedBuyUsd.toFixed(USDC_DECIMALS), USDC_DECIMALS)
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
      } finally {
        // Always release the re-entry guard, even on success — the user
        // might want to launch a second token after the redirect timer
        // elapses (e.g. they cancel the navigation and try again).
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
