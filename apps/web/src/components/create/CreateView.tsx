import { useState, useEffect } from "react";

import { useNavigate } from "react-router";

import styles from "./CreateView.module.css";
import LivePreview from "./LivePreview";
import PairSelector from "./PairSelector";
import SeedBuy from "./SeedBuy";
import TokenForm from "./TokenForm";
import { tokenPath } from "../../app/routes";
import { useCreateToken } from "../../hooks/useCreateToken";
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
    if (!name.trim() || !ticker.trim()) return;

    await create({
      name: name.trim(),
      ticker: ticker.trim(),
      description: description.trim(),
      direction,
      underlying: asset as "HYPE" | "ETH" | "BTC" | "SOL",
      leverage,
      imageFile,
      seedBuyUsd: seedAmt,
      socialLinks: [socialLinks.twitter, socialLinks.telegram, socialLinks.website].filter(Boolean),
    });
  };

  const buttonLabel = () => {
    if (!isConnected) return "CONNECT WALLET TO LAUNCH";
    if (launchStep === "signing") return "SIGN IN WALLET…";
    if (launchStep === "approving") return "APPROVING USDC…";
    if (launchStep === "deploying") return "DEPLOYING…";
    if (launchStep === "confirmed") return "✓ TOKEN LAUNCHED";
    if (launchStep === "error") return "⚡ RETRY LAUNCH";
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
              busy={isBusy}
              disabled={launchStep === "confirmed"}
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
      />
    </div>
  );
}
