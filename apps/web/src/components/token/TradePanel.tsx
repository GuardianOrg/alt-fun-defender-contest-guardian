import { useState, useEffect, useCallback, useRef } from "react";

import { MIN_USDC_BUY_AMOUNT, MIN_USDC_SELL_AMOUNT } from "@launchpad/shared";
import { createPublicClient, formatUnits, http, parseUnits } from "viem";
import { useAccount } from "wagmi";

import CreatorBadge from "./CreatorBadge";
import SettingsPopup from "./SettingsPopup";
import styles from "./TradePanel.module.css";
import TradePanelBufferWarning from "./TradePanelBufferWarning";
import TradePanelGasBanner from "./TradePanelGasBanner";
import TradePanelInput from "./TradePanelInput";
import TradePanelQuote from "./TradePanelQuote";
import { hyperEVM } from "../../config/chains";
import {
  RELAY_BRIDGE_HYPE_URL,
  RELAY_BRIDGE_USDC_URL,
  openRelayBridge,
} from "../../config/relay";
import { erc20Abi } from "../../contracts/abis";
import { ADDRESSES, USDC_DECIMALS } from "../../contracts/addresses";
import { useHypeFuel } from "../../hooks/useHypeFuel";
import { useIsGeoBlocked } from "../../hooks/useIsGeoBlocked";
import { useIsMintPaused } from "../../hooks/useLeveragedTokens";
import { useLiveTradeQuote } from "../../hooks/useLiveTradeQuote";
import { useReferral } from "../../hooks/useReferral";
import { useSlippage } from "../../hooks/useSlippage";
import { useTradeRouter } from "../../hooks/useTradeRouter";
import { useWallet } from "../../hooks/useWallet";
import {
  needsGas,
  parseTypedUsdcWei,
  planBuyGas,
  planSellGas,
} from "../../services/hypefuel";
import {
  cn,
  formatTokenAmount,
  formatUsd,
  shortenAddress,
} from "../../utils/format";
import Button from "../shared/Button";
import IconButton from "../shared/IconButton";
import SegmentedButton from "../shared/SegmentedButton";
import { buildTxAction, useToast } from "../shared/toast-context";

import type { Token } from "../../services/types";

const rpcUrl =
  import.meta.env.VITE_RPC_URL || "https://rpc.hyperliquid.xyz/evm";
// Batch the balance reads fired on every wallet/mode/token flip.
const hyperEvmClient = createPublicClient({
  chain: hyperEVM,
  transport: http(rpcUrl, { batch: true }),
});

// Thresholds for the contextual bridge/get-gas CTAs.
const LOW_USDC_THRESHOLD = MIN_USDC_BUY_AMOUNT;

interface Props {
  token: Token;
  /** Drop outer chrome when embedded inside the mobile modal. */
  chromeless?: boolean;
}

export default function TradePanel({ token, chromeless = false }: Props) {
  // Mint-paused LTs make buys revert, while sells can still redeem.
  const isMintPaused = useIsMintPaused(token.ltAddress);
  // Hidden tokens are sell-only so holders can exit.
  const isPolicyHidden = token.isHidden;
  // Geo gate blocks buys but leaves sells open; hook fails open while loading.
  const { isGeoBlocked } = useIsGeoBlocked();
  const [mode, setMode] = useState<"buy" | "sell">(
    isPolicyHidden ? "sell" : "buy",
  );
  // One-shot auto-switch avoids clobbering an in-progress buy.
  const autoSwitchedToSellRef = useRef(false);
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useSlippage();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [maxBalance, setMaxBalance] = useState<string | null>(null);
  const [maxBalanceWei, setMaxBalanceWei] = useState<bigint | null>(null);
  // `maxBalance` points at token balance in sell mode; USDC stays separate for buy validation.
  const [usdcBalance, setUsdcBalance] = useState<string | null>(null);
  const [usdcBalanceWei, setUsdcBalanceWei] = useState<bigint | null>(null);
  // Native HYPE balance drives GET GAS; keep wei for exact threshold compares.
  const [hypeBalanceWei, setHypeBalanceWei] = useState<bigint | null>(null);

  const { address } = useAccount();
  const { isConnected, connect } = useWallet();
  const referrer = useReferral();
  const { step, txHash, error, executeBuy, executeSell, reset } =
    useTradeRouter();
  const {
    phase: gasPhase,
    error: gasError,
    preview: gasPreview,
    inProgress: gasInProgress,
    loadPreview,
    execute: executeHypeFuel,
    reset: resetHypeFuel,
  } = useHypeFuel();
  const { pushToast } = useToast();
  // Submit-time snapshot for the confirmation toast, immune to post-confirm resets.
  const pendingTradeRef = useRef<{
    mode: "buy" | "sell";
    tokenAmount: number;
    usdcAmount: number;
    ticker: string;
  } | null>(null);

  const amtNum = parseFloat(amount) || 0;

  const { buyQuote, sellQuote } = useLiveTradeQuote({
    token,
    mode,
    amount,
    slippage,
  });

  const usdcAmount =
    mode === "buy" ? amtNum : sellQuote ? sellQuote.usdcOut : 0;

  const belowMinimum =
    amtNum > 0 && mode === "buy" && usdcAmount < MIN_USDC_BUY_AMOUNT;
  const sellBelowMinimum =
    amtNum > 0 &&
    mode === "sell" &&
    sellQuote != null &&
    sellQuote.usdcOut < MIN_USDC_SELL_AMOUNT;
  const sellExceedsBuffer =
    amtNum > 0 &&
    mode === "sell" &&
    sellQuote != null &&
    sellQuote.exceedsBuffer;
  // Only flag after balance load; disconnected users should see the connect CTA.
  const usdcBalanceNum = usdcBalance !== null ? parseFloat(usdcBalance) : null;
  const insufficientUsdc =
    isConnected &&
    mode === "buy" &&
    amtNum > 0 &&
    usdcBalanceNum !== null &&
    amtNum > usdcBalanceNum;
  // Use bigint sell-balance compare so 18-decimal token amounts stay exact.
  const insufficientToken = (() => {
    if (
      !isConnected ||
      mode !== "sell" ||
      amtNum <= 0 ||
      maxBalanceWei === null
    ) {
      return false;
    }
    try {
      return parseUnits(amount, 18) > maxBalanceWei;
    } catch {
      return false;
    }
  })();

  // Bridge USDC when the wallet cannot cover either the minimum buy or typed buy.
  const showBridgeUsdc =
    isConnected &&
    mode === "buy" &&
    usdcBalanceNum !== null &&
    (usdcBalanceNum < LOW_USDC_THRESHOLD || insufficientUsdc);

  // GET GAS shares the CTA slot with BRIDGE USDC; funding the trade takes priority.
  const gasNeeded = needsGas(hypeBalanceWei);
  const typedBuyUsdcWei =
    mode === "buy" ? parseTypedUsdcWei(amount) : 0n;
  const buyGasPlan =
    usdcBalanceWei !== null
      ? planBuyGas(usdcBalanceWei, typedBuyUsdcWei)
      : { action: "none" as const, proposedBuyUsdcWei: 0n, haircut: false };
  const sellGasPlan =
    usdcBalanceWei !== null
      ? planSellGas(usdcBalanceWei, amtNum > 0)
      : "none";
  const buyDisabledByPause = isMintPaused && mode === "buy";
  const buyDisabledByGeo = isGeoBlocked && mode === "buy";
  const buyDisabledByPolicy = isPolicyHidden && mode === "buy";
  const buyBlocked = buyDisabledByPause || buyDisabledByGeo || buyDisabledByPolicy;
  const hypefuelPrimary =
    gasNeeded &&
    !buyBlocked &&
    ((mode === "buy" && buyGasPlan.action === "hypefuel") ||
      (mode === "sell" && sellGasPlan === "hypefuel"));
  const showGetGas =
    isConnected &&
    gasNeeded &&
    !showBridgeUsdc &&
    !hypefuelPrimary;
  const showGasBanner =
    !showBridgeUsdc &&
    (hypefuelPrimary || gasInProgress || !!gasError);
  const haircutFromUsd =
    mode === "buy" && buyGasPlan.haircut
      ? Number(formatUnits(typedBuyUsdcWei, USDC_DECIMALS))
      : null;
  const haircutToUsd =
    mode === "buy" && buyGasPlan.haircut
      ? Number(formatUnits(buyGasPlan.proposedBuyUsdcWei, USDC_DECIMALS))
      : null;

  const loadBalance = useCallback(async () => {
    if (!address) {
      setUsdcBalance(null);
      setUsdcBalanceWei(null);
      setHypeBalanceWei(null);
      return;
    }
    // Fire gas and USDC reads independently; each updates its own UI slice.
    hyperEvmClient
      .getBalance({ address })
      .then((wei) => setHypeBalanceWei(wei))
      .catch(() => setHypeBalanceWei(null));
    // Always fetch USDC; sell mode still needs it for buy-side validation after toggles.
    try {
      const usdcRaw = (await hyperEvmClient.readContract({
        address: ADDRESSES.usdc,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address],
      })) as bigint;
      const usdcFormatted = formatUnits(usdcRaw, USDC_DECIMALS);
      setUsdcBalance(usdcFormatted);
      setUsdcBalanceWei(usdcRaw);

      if (mode === "buy") {
        setMaxBalance(usdcFormatted);
        setMaxBalanceWei(usdcRaw);
        return;
      }
    } catch {
      setUsdcBalance(null);
      setUsdcBalanceWei(null);
      if (mode === "buy") {
        setMaxBalance(null);
        setMaxBalanceWei(null);
        return;
      }
    }

    try {
      const balance = (await hyperEvmClient.readContract({
        address: token.address as `0x${string}`,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address],
      })) as bigint;
      setMaxBalance(formatUnits(balance, 18));
      setMaxBalanceWei(balance);
    } catch {
      setMaxBalance(null);
      setMaxBalanceWei(null);
    }
  }, [address, mode, token.address]);

  useEffect(() => {
    if (isConnected) loadBalance();
  }, [isConnected, loadBalance]);

  useEffect(() => {
    // Land sell-only states in SELL mode, but never clobber typed input.
    if (
      (isMintPaused || isPolicyHidden) &&
      !autoSwitchedToSellRef.current &&
      mode === "buy" &&
      amount === ""
    ) {
      setMode("sell");
      autoSwitchedToSellRef.current = true;
    }
  }, [isMintPaused, isPolicyHidden, mode, amount]);

  useEffect(() => {
    if (!address || !hypefuelPrimary) return;
    void loadPreview(address);
  }, [address, hypefuelPrimary, loadPreview]);

  useEffect(() => {
    resetHypeFuel();
  }, [amount, mode, resetHypeFuel]);

  const pendingAfterGasRef = useRef<{
    mode: "buy" | "sell";
    buyUsdcWei: bigint;
    tokenAmountWei: bigint;
  } | null>(null);
  const gasTradeLockRef = useRef(false);
  const [gasTradeLock, setGasTradeLock] = useState(false);

  const submitTrade = useCallback(
    (buyUsdc: number, tokenAmountWei: bigint, tradeMode: "buy" | "sell" = mode) => {
      if (tradeMode === "buy") {
        pendingTradeRef.current = {
          mode: "buy",
          tokenAmount: buyQuote?.tokensOutRaw ?? 0,
          usdcAmount: buyUsdc,
          ticker: token.ticker,
        };
        return executeBuy(token.address, buyUsdc, slippage, referrer);
      }
      pendingTradeRef.current = {
        mode: "sell",
        tokenAmount: parseFloat(formatUnits(tokenAmountWei, 18)),
        usdcAmount: sellQuote?.usdcOut ?? 0,
        ticker: token.ticker,
      };
      return executeSell(token.address, tokenAmountWei, slippage);
    },
    [
      mode,
      buyQuote,
      sellQuote,
      token.address,
      token.ticker,
      executeBuy,
      executeSell,
      slippage,
      referrer,
    ],
  );

  const sellTokenAmountWei = (): bigint => {
    const parsed = parseUnits(amount, 18);
    return maxBalanceWei !== null && parsed > maxBalanceWei
      ? maxBalanceWei
      : parsed;
  };

  const runHypeFuelThenTrade = async () => {
    if (gasTradeLockRef.current) return;
    gasTradeLockRef.current = true;
    setGasTradeLock(true);
    try {
      pendingAfterGasRef.current =
        mode === "buy"
          ? {
              mode: "buy",
              buyUsdcWei: buyGasPlan.proposedBuyUsdcWei,
              tokenAmountWei: 0n,
            }
          : {
              mode: "sell",
              buyUsdcWei: 0n,
              tokenAmountWei: sellTokenAmountWei(),
            };
      const ok = await executeHypeFuel();
      if (!ok) {
        pendingAfterGasRef.current = null;
        return;
      }
      await loadBalance();
      const pending = pendingAfterGasRef.current;
      pendingAfterGasRef.current = null;
      if (!pending) return;
      if (pending.mode === "buy") {
        const buyUsdc = Number(formatUnits(pending.buyUsdcWei, USDC_DECIMALS));
        setAmount(formatUnits(pending.buyUsdcWei, USDC_DECIMALS));
        await submitTrade(buyUsdc, 0n, "buy");
        return;
      }
      await submitTrade(0, pending.tokenAmountWei, "sell");
    } finally {
      gasTradeLockRef.current = false;
      setGasTradeLock(false);
    }
  };

  const doTrade = () => {
    if (gasTradeLockRef.current) return;
    if (!isConnected) {
      connect();
      return;
    }
    if (!amtNum) return;
    if (buyBlocked) return;
    if (gasNeeded) {
      if (hypefuelPrimary) {
        void runHypeFuelThenTrade();
      }
      return;
    }

    if (mode === "buy") {
      submitTrade(amtNum, 0n);
      return;
    }
    submitTrade(0, sellTokenAmountWei());
  };

  useEffect(() => {
    if (step === "confirmed") {
      loadBalance();
      if (txHash && pendingTradeRef.current) {
        const trade = pendingTradeRef.current;
        pendingTradeRef.current = null;
        pushToast({
          variant: "success",
          title: `${trade.mode === "buy" ? "Bought" : "Sold"} ${formatTokenAmount(trade.tokenAmount)} ${trade.ticker}`,
          subtitle: `For ${formatUsd(trade.usdcAmount)} USDC`,
          action: buildTxAction(txHash),
        });
      }
      const t = setTimeout(() => {
        reset();
        setAmount("");
      }, 3000);
      return () => clearTimeout(t);
    }
  }, [step, txHash, reset, loadBalance, pushToast]);

  const isBusy =
    step === "approving" ||
    step === "signing" ||
    step === "executing" ||
    gasInProgress ||
    gasTradeLock;

  const geoBlockShown = buyDisabledByGeo && amtNum > 0;

  // Render one validation surface at a time, with stale router errors lowest priority.
  type ActiveError =
    | { kind: "geoBlock" }
    | { kind: "exceedsBuffer" }
    | { kind: "insufficientUsdc" }
    | { kind: "insufficientToken" }
    | { kind: "belowMinimum" }
    | { kind: "sellBelowMinimum" }
    | { kind: "txError"; message: string };
  const suppressValidation = isBusy || step === "confirmed";
  const activeError: ActiveError | null = (() => {
    if (suppressValidation) return null;
    if (geoBlockShown) return { kind: "geoBlock" };
    if (insufficientToken) return { kind: "insufficientToken" };
    if (sellExceedsBuffer && sellQuote) return { kind: "exceedsBuffer" };
    if (insufficientUsdc) return { kind: "insufficientUsdc" };
    if (belowMinimum) return { kind: "belowMinimum" };
    if (sellBelowMinimum) return { kind: "sellBelowMinimum" };
    if (error) return { kind: "txError", message: error };
    return null;
  })();

  // Clear last-attempt router errors on actual amount edits.
  const handleAmountChange = useCallback(
    (next: string) => {
      setAmount(next);
      if (step === "error") reset();
    },
    [step, reset],
  );

  // Keep labels minimal; dedicated banners/errors carry disabled-state detail.
  const buttonLabel = () => {
    if (!isConnected) return "CONNECT WALLET";
    if (gasPhase === "signing" || step === "signing")
      return "SIGN IN WALLET…";
    if (gasPhase === "quoting" || gasPhase === "filling")
      return "GETTING HYPE…";
    if (step === "approving")
      return mode === "sell" ? "APPROVING TOKEN…" : "APPROVING USDC…";
    if (step === "executing") return mode === "buy" ? "BUYING…" : "SELLING…";
    if (step === "confirmed") return "CONFIRMED";
    if (step === "error") return "RETRY";
    if (hypefuelPrimary) return "GET HYPE FOR GAS";
    return `${mode === "buy" ? "BUY" : "SELL"} ${token.ticker}`;
  };

  const ticker = token.ticker;
  const panelClass = cn(styles.panel, chromeless && styles.panelChromeless);

  // Contract-frozen graduation window: both buy and sell would revert.
  if (token.status === "graduating") {
    return (
      <div className={panelClass}>
        <div className={styles.graduatingPanel}>
          <div className={styles.graduatingSpinner} />
          <div className={styles.graduatingTitle}>Token is graduating</div>
          <div className={styles.graduatingBody}>
            No buys or sells allowed during this period.
          </div>
          <div className={styles.graduatingHint}>
            Usually under 2 minutes — please wait while liquidity is seeded on
            HyperSwap.
          </div>
        </div>
        <CreatorBadge token={token} />
      </div>
    );
  }

  return (
    <div className={panelClass}>
      <div className={styles.toggleBar}>
        <div className={styles.toggleGrid}>
          <SegmentedButton
            fluid
            tone="mint"
            active={mode === "buy"}
            fullWidthIndicator
            disabled={isBusy || isMintPaused || isPolicyHidden}
            onClick={() => {
              setMode("buy");
              setAmount("");
              reset();
              resetHypeFuel();
            }}
            title={
              isPolicyHidden
                ? "Buys are disabled — this token has been removed from public listings"
                : isMintPaused
                  ? "Buys are paused while BounceTech has minting disabled on this leveraged token"
                  : undefined
            }
          >
            BUY
          </SegmentedButton>
          <SegmentedButton
            fluid
            tone="red"
            active={mode === "sell"}
            fullWidthIndicator
            disabled={isBusy}
            onClick={() => {
              setMode("sell");
              setAmount("");
              reset();
              resetHypeFuel();
            }}
          >
            SELL
          </SegmentedButton>
        </div>

      </div>

      <div className={styles.formBody}>
        {isPolicyHidden && (
          <div
            className={styles.pausedBanner}
            role="status"
            data-testid="trade-panel-hidden-banner"
          >
            <div className={styles.pausedBannerTitle}>Buys disabled</div>
            <div className={styles.pausedBannerBody}>
              {token.ticker} has been removed from public listings for violating
              our policies. You can still sell your remaining balance — buys are
              permanently disabled.
            </div>
          </div>
        )}
        {/* Policy-hidden beats mint-paused because it is permanent; sells stay open in both cases. */}
        {!isPolicyHidden && isMintPaused && (
          <div className={styles.pausedBanner} role="status">
            <div className={styles.pausedBannerTitle}>Buys paused</div>
            <div className={styles.pausedBannerBody}>
              BounceTech has paused minting on {token.ltName}, so new buys would
              revert on-chain. Sells still work as normal — your tokens can be
              redeemed for USDC any time.
            </div>
            <a
              className={styles.pausedBannerLink}
              href="https://docs.bounce.tech/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Learn more →
            </a>
          </div>
        )}
        <TradePanelInput
          mode={mode}
          amount={amount}
          setAmount={handleAmountChange}
          isBusy={isBusy}
          maxBalance={maxBalance}
          maxBalanceWei={maxBalanceWei}
          sellQuote={sellQuote}
          token={token}
          headerAction={
            <div className={styles.gearWrap}>
              <IconButton
                active={settingsOpen}
                onClick={() => setSettingsOpen(!settingsOpen)}
                aria-label="Max slippage"
                aria-expanded={settingsOpen}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </IconButton>

              {settingsOpen && (
                <SettingsPopup
                  slippage={slippage}
                  onSlippageChange={setSlippage}
                  onClose={() => setSettingsOpen(false)}
                />
              )}
            </div>
          }
        />

        {isConnected && mode === "buy" && (
          <div className={styles.balanceRow}>
            <span className={`${styles.balanceLabel} ui-subheading`}>
              USDC balance
            </span>
            <span className={styles.balanceValue}>
              {usdcBalance !== null
                ? `$${parseFloat(usdcBalance).toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}`
                : "—"}
            </span>
          </div>
        )}

        {isConnected && mode === "sell" && (
          <div className={styles.balanceRow}>
            <span className={`${styles.balanceLabel} ui-subheading`}>
              {ticker} balance
            </span>
            <span className={styles.balanceValue}>
              {maxBalance !== null
                ? `${formatTokenAmount(parseFloat(maxBalance))} ${ticker}`
                : "—"}
            </span>
          </div>
        )}

        {showGasBanner && (
          <TradePanelGasBanner
            preview={gasPreview}
            haircutFromUsd={haircutFromUsd}
            haircutToUsd={haircutToUsd}
            error={gasError}
            showRelayFallback={!!gasError}
          />
        )}

        {amtNum > 0 && !showGasBanner && (
          <TradePanelQuote
            mode={mode}
            ticker={ticker}
            buyQuote={buyQuote}
            sellQuote={sellQuote}
          />
        )}

        {/* Single error/warning slot; priority is resolved in `activeError`. */}
        {activeError?.kind === "exceedsBuffer" && sellQuote && (
          <TradePanelBufferWarning sellQuote={sellQuote} ticker={ticker} />
        )}

        {activeError?.kind === "geoBlock" && (
          <div className={styles.errorBox}>
            <span className={styles.errorIcon}>⚠</span>
            Service unavailable in your region
          </div>
        )}

        {activeError?.kind === "belowMinimum" && (
          <div className={styles.errorBox}>
            <span className={styles.errorIcon}>⚠</span>
            Minimum buy is ${MIN_USDC_BUY_AMOUNT} USDC
          </div>
        )}

        {activeError?.kind === "sellBelowMinimum" && (
          <div className={styles.errorBox}>
            <span className={styles.errorIcon}>⚠</span>
            Minimum sell is ${MIN_USDC_SELL_AMOUNT} USDC
          </div>
        )}

        {activeError?.kind === "insufficientUsdc" && (
          <div className={styles.errorBox}>
            <span className={styles.errorIcon}>⚠</span>
            Insufficient USDC
          </div>
        )}

        {activeError?.kind === "insufficientToken" && (
          <div className={styles.errorBox}>
            <span className={styles.errorIcon}>⚠</span>
            Insufficient {ticker} balance
          </div>
        )}

        {activeError?.kind === "txError" && (
          <div className={styles.errorBox}>
            <span className={styles.errorIcon}>⚠</span>
            {activeError.message}
          </div>
        )}

        {step === "confirmed" && txHash && (
          <div className={styles.confirmedBox}>
            <span>✓ Transaction Confirmed</span>
            <a
              className={styles.confirmedTxLink}
              href={`https://hyperevmscan.io/tx/${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {shortenAddress(txHash)}
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </a>
          </div>
        )}

        {/* Funding CTA shares the primary button area and is hidden during tx/success states. */}
        {!isBusy && step !== "confirmed" && showBridgeUsdc && (
          <Button
            variant="secondary"
            fullWidth
            onClick={() => openRelayBridge(RELAY_BRIDGE_USDC_URL)}
          >
            BRIDGE USDC
          </Button>
        )}
        {!isBusy && step !== "confirmed" && showGetGas && (
          <Button
            variant="secondary"
            fullWidth
            onClick={() => openRelayBridge(RELAY_BRIDGE_HYPE_URL)}
          >
            GET GAS
          </Button>
        )}

        <Button
          variant={mode === "buy" ? "primary" : "danger"}
          fullWidth
          busy={isBusy}
          disabled={
            step === "confirmed" ||
            buyDisabledByPause ||
            buyDisabledByGeo ||
            buyDisabledByPolicy ||
            belowMinimum ||
            sellBelowMinimum ||
            sellExceedsBuffer ||
            insufficientUsdc ||
            insufficientToken ||
            (isConnected && amtNum <= 0 && !gasInProgress) ||
            (isConnected &&
              gasNeeded &&
              !hypefuelPrimary &&
              !gasInProgress)
          }
          className={step === "confirmed" ? styles.ctaConfirmed : undefined}
          onClick={doTrade}
        >
          {buttonLabel()}
        </Button>

        {isBusy && (
          <div className={styles.busyHint}>
            <div className={styles.liveDot} />
            {gasPhase === "signing"
              ? "Sign to get HYPE for gas — this is a signature, not a transaction."
              : gasPhase === "quoting"
                ? "Getting a HypeFuel quote…"
                : gasPhase === "filling"
                  ? "HypeFuel is sending HYPE to your wallet…"
                  : step === "signing"
                    ? "Sign the permit in your wallet…"
                    : step === "approving"
                      ? mode === "sell"
                        ? "Waiting for token approval in wallet…"
                        : "Waiting for USDC approval in wallet…"
                      : "Confirm transaction in wallet…"}
          </div>
        )}
      </div>

      <CreatorBadge token={token} />
    </div>
  );
}
