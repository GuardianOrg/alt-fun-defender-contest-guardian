import { useState, useEffect } from "react";

import { useNavigate } from "react-router";

import styles from "./CreateView.module.css";
import LivePreview from "./LivePreview";
import PairSelector from "./PairSelector";
import SeedBuy from "./SeedBuy";
import TokenForm from "./TokenForm";
import { tokenPath } from "../../app/routes";
import { useCreateToken } from "../../hooks/useCreateToken";
import { useVanityAddress } from "../../hooks/useVanityAddress";
import { useWallet } from "../../hooks/useWallet";
import Button from "../shared/Button";

import type { UnderlyingAsset, Leverage } from "../../config/constants";
import type { Direction } from "../../services/types";

export default function CreateView() {
  const navigate = useNavigate();
  const [direction, setDirection] = useState<Direction>("long");
  const [asset, setAsset] = useState<UnderlyingAsset>("HYPE");
  const [leverage, setLeverage] = useState<Leverage>(2);
  const [name, setName] = useState("");
  const [ticker, setTicker] = useState("");
  const [description, setDescription] = useState("");
  const [socialLinks, setSocialLinks] = useState({ twitter: "", telegram: "", website: "" });
  const [seedAmount, setSeedAmount] = useState("");
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | undefined>();

  const { isConnected, connect } = useWallet();
  const { step: launchStep, error: launchError, warning: launchWarning, tokenAddress, create } = useCreateToken();
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
  const vanity = useVanityAddress({ name: debouncedName, ticker: debouncedTicker });
  const [waitingForVanity, setWaitingForVanity] = useState(false);
  const [vanityError, setVanityError] = useState<string | null>(null);
  const seedAmt = parseFloat(seedAmount) || 0;
  const isBusy =
    launchStep === "approving" || launchStep === "signing" || launchStep === "deploying";

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
        underlying: asset as "HYPE" | "ETH" | "BTC" | "SOL",
        leverage,
        imageFile,
        seedBuyUsd: seedAmt,
        socialLinks: [socialLinks.twitter, socialLinks.telegram, socialLinks.website].filter(Boolean),
      },
      vanityResult.salt,
    );
  };

  const buttonLabel = () => {
    if (!isConnected) return "CONNECT WALLET TO LAUNCH";
    if (waitingForVanity) return "FINDING YOUR ADDRESS…";
    if (launchStep === "signing") return "SIGN IN WALLET…";
    if (launchStep === "approving") return "APPROVING USDC…";
    if (launchStep === "deploying") return "DEPLOYING…";
    if (launchStep === "confirmed") return "✓ TOKEN LAUNCHED";
    if (launchStep === "error") return "⚡ RETRY LAUNCH";
    if (vanity.status === "error") return "MINER FAILED — REFRESH";
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
              size="lg"
              fullWidth
              busy={isBusy || waitingForVanity}
              disabled={launchStep === "confirmed" || vanity.status === "error"}
              className={launchStep === "confirmed" ? styles.launchButtonConfirmed : undefined}
              onClick={handleSubmit}
            >
              {buttonLabel()}
            </Button>

            {isBusy && (
              <div className={styles.busyRow}>
                <div className={styles.busyDot} />
                {launchStep === "signing"
                  ? "Sign the USDC permit in your wallet…"
                  : launchStep === "approving"
                    ? "Approve USDC spend in your wallet…"
                    : "Confirm deployment in your wallet…"}
              </div>
            )}

            {launchStep === "idle" && (
              <div className={styles.idleHint}>
                {seedAmt > 0
                  ? `Sign a permit for $${seedAmt.toFixed(2)} USDC, then your token deploys in one tx`
                  : "You will be asked to confirm in your wallet"}
              </div>
            )}

            {seedAmt > 0 && launchStep === "idle" && (
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
        predictedAddress={vanity.result?.address ?? null}
        vanityStatus={vanity.status}
      />
    </div>
  );
}
