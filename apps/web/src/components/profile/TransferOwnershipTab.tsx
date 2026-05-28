import { useState } from "react";

import profileStyles from "./ProfileView.module.css";
import styles from "./TransferOwnershipTab.module.css";
import { useTransferCreator, validateNewCreator } from "../../hooks/useTransferCreator";
import { useWallet } from "../../hooks/useWallet";
import { cn, getErrorMessage, shortenAddress } from "../../utils/format";
import { srcSetFor, transformImageUrl } from "../../utils/image";
import Button from "../shared/Button";
import CopyAddressButton from "../shared/CopyAddressButton";
import Skeleton from "../shared/Skeleton";
import { useToast, buildTxAction } from "../shared/toast-context";

import type { CreatedToken } from "../../services/types";

export interface TransferOwnershipTabProps {
  /** Tokens the connected wallet has launched (per the Postgres `creator`
   *  column). The list is intentionally allowed to include tokens whose
   *  on-chain creator has already been transferred away — the contract is
   *  the source of truth and will revert with `NotCreator` in that case;
   *  the toast then surfaces a clean message. */
  tokens: readonly CreatedToken[] | undefined;
  /** True while the parent's first `useCreatorEarnings` fetch is in flight
   *  and we don't yet know whether the wallet has any tokens. Drives a
   *  skeleton row so the panel doesn't flash the empty state on cold load. */
  isLoading: boolean;
  /** Called after a successful transfer so the parent can refetch its
   *  creator-earnings query (the row should disappear once the indexer
   *  catches up; until then the row stays visible but a re-attempt will
   *  revert with `NotCreator`). */
  onTransferred: () => void;
  /** True when no wallet is currently connected. The whole tab body is
   *  replaced with a "connect wallet" prompt in that case — no point
   *  pretending to load a list we can't query. */
  walletConnected: boolean;
}

const TRANSFER_SKELETON_COUNT = 2;

export default function TransferOwnershipTab({
  tokens,
  isLoading,
  onTransferred,
  walletConnected,
}: TransferOwnershipTabProps) {
  // The connected wallet *is* the current creator for every token in this
  // list — the parent only passes tokens whose Postgres `creator` row
  // matches the connected wallet (see `creatorService.getEarnings`). We
  // forward it down so per-row validation can short-circuit the
  // "transferring to yourself" case before the wallet popup, mirroring
  // the on-chain `Bonding.InvalidInput` revert.
  const { address: connectedWallet } = useWallet();

  if (!walletConnected) {
    return (
      <div className={profileStyles.emptyState}>
        <div className={profileStyles.emptyTitle}>Wallet not connected</div>
        <div className={profileStyles.emptyBody}>
          Connect your wallet to manage tokens you've launched.
        </div>
      </div>
    );
  }

  if (isLoading && (!tokens || tokens.length === 0)) {
    return (
      <div aria-busy="true" aria-label="Loading tokens">
        <TransferIntro />
        <div className={styles.list}>
          {Array.from({ length: TRANSFER_SKELETON_COUNT }, (_, i) => (
            <TransferRowSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  if (!tokens || tokens.length === 0) {
    return (
      <div className={profileStyles.emptyState}>
        <div className={profileStyles.emptyTitle}>No tokens to transfer</div>
        <div className={profileStyles.emptyBody}>
          Tokens you've launched will appear here. You can transfer the
          creator role to a different wallet at any time.
        </div>
      </div>
    );
  }

  return (
    <>
      <TransferIntro />
      <div className={styles.list}>
        {tokens.map((token) => (
          <TransferRow
            key={token.address}
            token={token}
            currentCreator={connectedWallet}
            onTransferred={onTransferred}
          />
        ))}
      </div>
    </>
  );
}

/* ───────── Intro banner ───────── */

/**
 * Static explainer that sits above the per-token list. Two beats:
 *   1. What `transferCreator` does (future fees → new wallet).
 *   2. The pooled-fee caveat — already-accrued USDC stays with the
 *      *old* wallet until it claims, because `FeeVault` keys balances
 *      by address, not by token. Surface this loudly: a creator who
 *      transfers without claiming first effectively strands their
 *      pending USDC behind a wallet they may no longer control.
 */
function TransferIntro() {
  return (
    <div className={styles.intro}>
      <div className={styles.introTitle}>Transfer creator role</div>
      <div className={styles.introBody}>
        Move the creator role for a token you launched to a different wallet.
        Once transferred, all future trading fees for that token will accrue
        to the new wallet.
      </div>
      <div className={styles.introWarning}>
        <span className={styles.introWarningLabel}>Heads up</span>
        Pending creator rewards are pooled per wallet — claim any unclaimed
        USDC on the Creator Rewards tab <em>before</em> transferring, or it
        will stay with your current wallet.
      </div>
    </div>
  );
}

/* ───────── Per-token row ───────── */

interface TransferRowProps {
  token: CreatedToken;
  /** Current creator wallet for this token. Compared against the form
   *  input so we can short-circuit a "same-as-current" submit before the
   *  wallet popup. `undefined` is treated as "unknown" by the validator
   *  (it allows the submit and lets the on-chain `InvalidInput` revert
   *  catch the case). */
  currentCreator: string | undefined;
  onTransferred: () => void;
}

function TransferRow({ token, currentCreator, onTransferred }: TransferRowProps) {
  const [imgError, setImgError] = useState(false);
  const [newAddress, setNewAddress] = useState("");
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const { transfer } = useTransferCreator();
  const { pushToast } = useToast();

  const validation = validateNewCreator(newAddress, currentCreator);
  // Suppress the inline error until the user has interacted at least once
  // — no point shouting "enter a wallet address" before they've clicked
  // into the field.
  const showError = touched && !validation.ok && newAddress.length > 0;

  const handleSubmit = async () => {
    setTouched(true);
    if (!validation.ok) return;
    setSubmitting(true);
    try {
      const { txHash } = await transfer(
        token.address as `0x${string}`,
        validation.address,
      );
      pushToast({
        variant: "success",
        title: `Transferred ${token.ticker} creator role`,
        subtitle: `New creator: ${shortenAddress(validation.address)}`,
        action: buildTxAction(txHash),
      });
      setNewAddress("");
      setTouched(false);
      onTransferred();
    } catch (err) {
      pushToast({
        variant: "error",
        title: `Couldn't transfer ${token.ticker}`,
        subtitle: getErrorMessage(err),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.row}>
      <div className={styles.rowHead}>
        <div className={profileStyles.balanceLogoWrap}>
          {token.imageUrl && !imgError ? (
            <img
              src={transformImageUrl(token.imageUrl, { width: 64 })}
              srcSet={srcSetFor(token.imageUrl, 64) || undefined}
              alt=""
              width={64}
              height={64}
              className={profileStyles.balanceLogo}
              onError={() => setImgError(true)}
              loading="lazy"
              decoding="async"
            />
          ) : (
            <span
              className={profileStyles.balanceLogoFallback}
              aria-hidden="true"
            >
              {token.name.charAt(0).toUpperCase()}
            </span>
          )}
        </div>
        <div className={styles.tokenMeta}>
          <span className={profileStyles.balanceTokenTicker}>
            {token.ticker}
          </span>
          <span className={profileStyles.balanceTokenName}>{token.name}</span>
        </div>
        <div className={styles.tokenAddress}>
          <span className={profileStyles.balanceAddressText}>
            {shortenAddress(token.address)}
          </span>
          <CopyAddressButton address={token.address} />
        </div>
      </div>

      <label className={styles.inputBlock}>
        <span className={cn(styles.inputLabel, "ui-subheading")}>
          New creator wallet
        </span>
        <input
          type="text"
          inputMode="text"
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          className={cn(styles.input, showError && styles.inputError)}
          placeholder="0x…"
          value={newAddress}
          onChange={(e) => setNewAddress(e.target.value)}
          onBlur={() => setTouched(true)}
          aria-invalid={showError}
          aria-describedby={
            showError ? `transfer-err-${token.address}` : undefined
          }
          disabled={submitting}
        />
        {showError && !validation.ok && (
          <span
            className={styles.inputErrorText}
            id={`transfer-err-${token.address}`}
            role="alert"
          >
            {validation.reason}
          </span>
        )}
      </label>

      <Button
        variant="primary"
        size="md"
        fullWidth
        busy={submitting}
        disabled={!validation.ok || submitting}
        onClick={handleSubmit}
      >
        {submitting ? "Transferring\u2026" : "Transfer creator role"}
      </Button>
    </div>
  );
}

function TransferRowSkeleton() {
  return (
    <div className={styles.row} aria-hidden="true">
      <div className={styles.rowHead}>
        <div className={profileStyles.balanceLogoWrap}>
          <Skeleton shape="block" width="4rem" height="4rem" radius="3px" />
        </div>
        <div className={styles.tokenMeta}>
          <Skeleton width="6rem" height="15px" />
          <Skeleton width="8rem" height="12px" />
        </div>
        <div className={styles.tokenAddress}>
          <Skeleton width="6rem" height="12px" />
        </div>
      </div>
      <Skeleton shape="block" width="100%" height="3.6rem" radius="3px" />
      <Skeleton shape="block" width="100%" height="3rem" radius="3px" />
    </div>
  );
}
