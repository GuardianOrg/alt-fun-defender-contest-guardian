import { useState, useEffect } from "react";

import { getAssetDisplayName, MIN_USDC_BUY_AMOUNT } from "@launchpad/shared";
import { useNavigate } from "react-router";

import styles from "./CreateView.module.css";
import LivePreview from "./LivePreview";
import PairSelector from "./PairSelector";
import SeedBuy from "./SeedBuy";
import TokenForm from "./TokenForm";
import { tokenPath } from "../../app/routes";
import { useAvailableUnderlyingAssets } from "../../hooks/useAssets";
import { useCreateToken } from "../../hooks/useCreateToken";
import { useIsGeoBlocked } from "../../hooks/useIsGeoBlocked";
import { useLeveragedTokens } from "../../hooks/useLeveragedTokens";
import { useVanityAddress } from "../../hooks/useVanityAddress";
import { useWallet } from "../../hooks/useWallet";
import { cn } from "../../utils/format";
import Button from "../shared/Button";

import type { UnderlyingAsset, Leverage } from "../../config/constants";
import type { Direction } from "../../services/types";

export default function CreateView() {
  const navigate = useNavigate();
  const [direction, setDirection] = useState<Direction>("long");
  const [asset, setAsset] = useState<UnderlyingAsset>("HYPE");
  const [leverage, setLeverage] = useState<Leverage>(3);
  const [name, setName] = useState("");
  const [ticker, setTicker] = useState("");
  const [description, setDescription] = useState("");
  const [socialLinks, setSocialLinks] = useState({
    twitter: "",
    telegram: "",
    website: "",
  });
  // Default to the on-chain seed floor so the form starts valid.
  const [seedAmount, setSeedAmount] = useState(String(MIN_USDC_BUY_AMOUNT));
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | undefined>();

  const { isConnected, connect } = useWallet();
  // Creation includes a seed buy, so the buy-side geo gate applies here too.
  const { isGeoBlocked } = useIsGeoBlocked();
  const {
    step: launchStep,
    error: launchError,
    warning: launchWarning,
    tokenAddress,
    create,
  } = useCreateToken();
  // Debounce salt inputs so the worker pool does not restart per keystroke.
  const trimmedName = name.trim();
  const trimmedTicker = ticker.trim();
  const [debouncedName, setDebouncedName] = useState(trimmedName);
  const [debouncedTicker, setDebouncedTicker] = useState(trimmedTicker);
  useEffect(() => {
    const handle = setTimeout(() => {
      setDebouncedName(trimmedName);
      setDebouncedTicker(trimmedTicker);
    }, 250);
    return () => clearTimeout(handle);
  }, [trimmedName, trimmedTicker]);
  const vanity = useVanityAddress({
    name: debouncedName,
    ticker: debouncedTicker,
  });
  const [waitingForVanity, setWaitingForVanity] = useState(false);
  const [vanityError, setVanityError] = useState<string | null>(null);
  const availableAssets = useAvailableUnderlyingAssets();
  const noDetectedPairs = availableAssets.length === 0;
  useEffect(() => {
    if (availableAssets.length === 0 || availableAssets.includes(asset)) return;
    setAsset(availableAssets[0]);
  }, [asset, availableAssets]);
  const seedAmt = parseFloat(seedAmount) || 0;
  // Mirror `Zap.MIN_SEED_USDC` so users do not sign a reverting tx.
  const seedBelowMin = seedAmt < MIN_USDC_BUY_AMOUNT;
  // Refuse launches against LTs that are known to be mint-paused.
  const { data: liveLTs } = useLeveragedTokens();
  const isLong = direction === "long";
  const selectedLT = liveLTs?.find(
    (lt) =>
      lt.targetAsset === asset &&
      lt.targetLeverage === leverage &&
      lt.isLong === isLong,
  );
  const pairMintPaused = selectedLT?.mintPaused === true;
  const isBusy =
    launchStep === "uploading" ||
    launchStep === "approving" ||
    launchStep === "signing" ||
    launchStep === "deploying";

  useEffect(() => {
    if (launchStep !== "confirmed") return;
    const delay = launchWarning ? 8000 : 1500;
    const timer = setTimeout(() => {
      navigate(tokenAddress ? tokenPath(tokenAddress) : "/");
    }, delay);
    return () => clearTimeout(timer);
  }, [launchStep, tokenAddress, launchWarning, navigate]);

  const handleSubmit = async () => {
    if (!isConnected) {
      connect();
      return;
    }
    if (!trimmedName || !trimmedTicker) return;
    if (seedBelowMin) return;
    if (noDetectedPairs) return;
    // Guard stale renders between geo polling and a click.
    if (isGeoBlocked) return;
    // `useCreateToken` repeats this before any wallet popup.
    if (pairMintPaused) return;
    if (vanity.status === "error") {
      setVanityError(
        "Address miner failed to start. Please refresh and try again.",
      );
      return;
    }

    // Pass live trimmed inputs so `ensureSalt` can flush the debounce before launch.
    setWaitingForVanity(true);
    setVanityError(null);
    let vanityResult;
    try {
      vanityResult = await vanity.ensureSalt(trimmedName, trimmedTicker);
    } catch (err) {
      setVanityError(err instanceof Error ? err.message : "Mining failed");
      setWaitingForVanity(false);
      return;
    }
    setWaitingForVanity(false);

    await create(
      {
        name: trimmedName,
        ticker: trimmedTicker,
        description: description.trim(),
        direction,
        underlying: asset,
        leverage,
        imageFile,
        seedBuyUsd: seedAmt,
        socialLinks: [
          socialLinks.twitter,
          socialLinks.telegram,
          socialLinks.website,
        ].filter(Boolean),
      },
      vanityResult.salt,
      vanityResult.address,
      // Cached salt collision: drop it, re-mine, and retry the CREATE2 pre-flight.
      async () => {
        setWaitingForVanity(true);
        try {
          vanity.invalidateCachedSalt(trimmedName, trimmedTicker);
          const fresh = await vanity.ensureSalt(trimmedName, trimmedTicker);
          return { salt: fresh.salt, address: fresh.address };
        } finally {
          setWaitingForVanity(false);
        }
      },
    );
  };

  const buttonLabel = () => {
    if (!isConnected) return "CONNECT WALLET TO LAUNCH";
    if (waitingForVanity) return "FINDING YOUR ADDRESS…";
    if (launchStep === "uploading") return "UPLOADING IMAGE…";
    if (launchStep === "signing") return "SIGN IN WALLET…";
    if (launchStep === "approving") return "APPROVING USDC…";
    if (launchStep === "deploying") return "DEPLOYING…";
    if (launchStep === "confirmed") return "✓ TOKEN LAUNCHED";
    if (launchStep === "error") return "RETRY LAUNCH";
    if (vanity.status === "error") return "MINER FAILED - REFRESH";
    if (noDetectedPairs) return "LOADING PAIRS…";
    if (pairMintPaused) return "PAIR MINTING PAUSED";
    if (isConnected && seedBelowMin) return `MIN SEED $${MIN_USDC_BUY_AMOUNT}`;
    return "LAUNCH TOKEN";
  };

  return (
    <div className={styles.layout}>
      <div className={styles.formColumn}>
        <div className={styles.pageHeader}>
          <div className={styles.eyebrow}>new token</div>
          <div className={styles.heading}>Create an altcoin</div>
          <div className={styles.subheading}>
            Choose a direction, pick your underlying, set your leverage, and
            deploy to the bonding curve in one transaction.
          </div>
        </div>

        <div className={styles.steps}>
          <PairSelector
            direction={direction}
            asset={asset}
            leverage={leverage}
            onDirectionChange={setDirection}
            onAssetChange={setAsset}
            onLeverageChange={setLeverage}
          />
          <TokenForm
            name={name}
            ticker={ticker}
            description={description}
            socialLinks={socialLinks}
            imagePreview={imagePreview}
            onNameChange={setName}
            onTickerChange={setTicker}
            onDescriptionChange={setDescription}
            onSocialLinksChange={setSocialLinks}
            onImageChange={(file, preview) => {
              setImageFile(file ?? undefined);
              setImagePreview(preview);
            }}
          />
          <SeedBuy seedAmount={seedAmount} onSeedChange={setSeedAmount} />

          <div className={styles.ctaArea}>
            {isGeoBlocked && (
              <div className={styles.errorBanner}>
                <span className={styles.errorIcon}>⚠</span>
                Service unavailable in your region
              </div>
            )}

            {pairMintPaused && (
              <div className={styles.warningBanner}>
                <span className={styles.warningIcon}>⚠</span>
                BounceTech has paused minting on {getAssetDisplayName(
                  asset,
                )}{" "}
                {leverage}× {direction}. Launching would revert on the mandatory
                seed buy - pick a different pair or wait for minting to resume.
              </div>
            )}

            {launchError && (
              <div className={styles.errorBanner}>
                <span className={styles.errorIcon}>⚠</span>
                {launchError}
              </div>
            )}

            {vanityError && (
              <div className={styles.errorBanner}>
                <span className={styles.errorIcon}>⚠</span>
                {vanityError}
              </div>
            )}

            {launchStep === "confirmed" && launchWarning && (
              <div className={styles.warningBanner}>
                <span className={styles.warningIcon}>⚠</span>
                {launchWarning}
              </div>
            )}

            {launchStep === "confirmed" && (
              <div className={styles.successBanner}>
                <span>✓</span>
                Token deployed! Redirecting…
              </div>
            )}

            <Button
              variant="primary"
              size="sm"
              fullWidth
              busy={isBusy || waitingForVanity}
              disabled={
                launchStep === "confirmed" ||
                vanity.status === "error" ||
                isGeoBlocked ||
                noDetectedPairs ||
                pairMintPaused ||
                (isConnected && seedBelowMin)
              }
              className={cn(
                styles.launchButton,
                launchStep === "confirmed" && styles.launchButtonConfirmed,
              )}
              onClick={handleSubmit}
            >
              {buttonLabel()}
            </Button>

            {isBusy && (
              <div className={styles.busyRow}>
                <div className={styles.busyDot} />
                {launchStep === "uploading"
                  ? "Moderating and uploading image…"
                  : launchStep === "signing"
                    ? "Sign the USDC permit in your wallet…"
                    : launchStep === "approving"
                      ? "Approve USDC spend in your wallet…"
                      : "Confirm deployment in your wallet…"}
              </div>
            )}

            {launchStep === "idle" && !seedBelowMin && (
              <div className={styles.idleHint}>
                Sign a permit for ${seedAmt.toFixed(2)} USDC, then your token
                deploys in one tx. The seed buy is routed atomically through the
                TX Router, and you receive tokens directly.
              </div>
            )}
          </div>
        </div>
      </div>

      <LivePreview
        name={name}
        ticker={ticker}
        direction={direction}
        asset={asset}
        leverage={leverage}
        imagePreview={imagePreview}
      />
    </div>
  );
}
