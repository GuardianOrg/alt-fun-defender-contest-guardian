import { useState, useEffect } from "react";

import { getAssetDisplayName, MIN_USDC_BUY_AMOUNT } from "@launchpad/shared";
import { useNavigate } from "react-router";

import styles from "./CreateView.module.css";
import LivePreview from "./LivePreview";
import PairSelector from "./PairSelector";
import SeedBuy from "./SeedBuy";
import TokenForm from "./TokenForm";
import { tokenPath } from "../../app/routes";
import { useCreateToken } from "../../hooks/useCreateToken";
import { useIsGeoBlocked } from "../../hooks/useIsGeoBlocked";
import { useLeveragedTokens } from "../../hooks/useLeveragedTokens";
import { useVanityAddress } from "../../hooks/useVanityAddress";
import { useWallet } from "../../hooks/useWallet";
import VanityEffect from "../effects/VanityEffect";
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
  // Default to the on-chain `MIN_SEED_USDC` floor so the form lands valid
  // out of the box — nothing below this can be submitted anyway.
  const [seedAmount, setSeedAmount] = useState(String(MIN_USDC_BUY_AMOUNT));
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | undefined>();

  const { isConnected, connect } = useWallet();
  // CDN-derived geo gate. Token creation always includes a mandatory seed
  // buy that mints LT, so the same compliance constraint that disables
  // BUYS in the trade panel applies here. Fail-open while the trace
  // fetch is in flight (hook returns `false` until it resolves).
  const { isGeoBlocked } = useIsGeoBlocked();
  const {
    step: launchStep,
    error: launchError,
    warning: launchWarning,
    tokenAddress,
    create,
  } = useCreateToken();
  // Mining starts as soon as the wallet is connected *and* the user has
  // entered a name + ticker — both feed into the on-chain salt mix, so we
  // can't begin mining without them. We debounce the trimmed values into
  // the hook so the worker pool doesn't tear down + reseed per keystroke;
  // by the time the user clicks Launch the salt is usually already mined.
  // `ensureSalt(trimmedName, trimmedTicker)` flushes the debounce by
  // force-restarting against the live values if they differ — see the
  // hook for the race resolution. There is no random-salt fallback: the
  // contract enforces the vanity suffix on-chain.
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
  const seedAmt = parseFloat(seedAmount) || 0;
  // Mirrors `Zap.MIN_SEED_USDC` on-chain: the contract reverts with
  // `BelowMinSeed` if `seedUsdcAmount < $20`. Block the Launch button at
  // the UI layer so the user never signs a reverting tx.
  const seedBelowMin = seedAmt < MIN_USDC_BUY_AMOUNT;
  // Pull the live BounceTech LT directory so we can refuse to launch
  // against a paused LT — token creation always includes a mandatory
  // seed buy (`Zap.MIN_SEED_USDC`) and that buy mints LT, which would
  // revert. `selectedLT === undefined` while the directory is loading
  // (or the asset/leverage tuple isn't supported); the latter is already
  // caught downstream in `useCreateToken`, so we only block on the
  // affirmative "yes, paused" signal here.
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
    // Belt-and-braces for the geo gate — the Launch button is disabled
    // while geo-blocked, but a stale render between a country flip and
    // the click shouldn't be able to slip a launch tx through.
    if (isGeoBlocked) return;
    // Mirrored in `useCreateToken` as a belt-and-braces — if the directory
    // is loading we let the click through and the hook handles the case
    // with the same error message before any wallet popup.
    if (pairMintPaused) return;
    if (vanity.status === "error") {
      setVanityError(
        "Vanity address miner failed to start. Please refresh and try again.",
      );
      return;
    }

    // Wait for the miner. With a worker pool this almost always returns
    // immediately (mining starts at wallet connect and finishes in
    // 50-300ms); on slow devices it may take a few seconds. We pass the
    // live trimmed `(name, ticker)` so the hook flushes the input
    // debounce if the user clicked Launch before it caught up — the
    // contract reverts with `NotVanityAddress` if the salt was mined for
    // a different tuple, so this race must be closed.
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
      // Bytecode-at-predicted-address means the cached salt collides
      // with a previously-deployed token. Drop the cache row and
      // restart the miner so the next click mines a fresh salt
      // against a different CREATE2 address — otherwise the user is
      // stranded behind a permanent `FailedDeployment()` revert.
      () => vanity.invalidateCachedSalt(trimmedName, trimmedTicker),
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
    if (launchStep === "error") return "⚡ RETRY LAUNCH";
    if (vanity.status === "error") return "MINER FAILED — REFRESH";
    if (pairMintPaused) return "PAIR MINTING PAUSED";
    if (isConnected && seedBelowMin) return `MIN SEED $${MIN_USDC_BUY_AMOUNT}`;
    return "⚡ LAUNCH TOKEN";
  };

  return (
    <div className={styles.layout}>
      <div className={styles.formColumn}>
        <div className={styles.pageHeader}>
          <div className={styles.eyebrow}>new token</div>
          <div className={styles.heading}>Create a levered token</div>
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

          <div className={styles.divider} />

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

          <div className={styles.divider} />

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
                BounceTech has paused minting on{" "}
                {getAssetDisplayName(asset)} {leverage}× {direction}. Launching
                would revert on the mandatory seed buy — pick a different
                pair or wait for minting to resume.
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

            <VanityEffect
              zeros={vanity.best?.zeros ?? 0}
              size="button"
              as="block"
              className={styles.launchButtonWrap}
            >
              <Button
                variant="primary"
                size="lg"
                fullWidth
                busy={isBusy || waitingForVanity}
                disabled={
                  launchStep === "confirmed" ||
                  vanity.status === "error" ||
                  isGeoBlocked ||
                  pairMintPaused ||
                  (isConnected && seedBelowMin)
                }
                className={
                  launchStep === "confirmed"
                    ? styles.launchButtonConfirmed
                    : undefined
                }
                onClick={handleSubmit}
              >
                {buttonLabel()}
              </Button>
            </VanityEffect>

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
                deploys in one tx
              </div>
            )}

            {launchStep === "idle" && !seedBelowMin && (
              <div className={styles.seedInfo}>
                Seed buy of{" "}
                <span className={styles.mintHighlight}>
                  ${seedAmt.toFixed(2)} USDC
                </span>{" "}
                is routed atomically through the TX Router — you receive tokens
                directly.
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
        predictedAddress={vanity.best?.address ?? null}
        vanityZeros={vanity.best?.zeros ?? 0}
        vanityStatus={vanity.status}
      />
    </div>
  );
}
