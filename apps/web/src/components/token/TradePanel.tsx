import { useState, useEffect, useCallback, useRef } from "react";

import { MIN_USDC_BUY_AMOUNT, MIN_USDC_SELL_AMOUNT } from "@launchpad/shared";
import { createPublicClient, formatUnits, http, parseUnits } from "viem";
import { useAccount } from "wagmi";

import CreatorBadge from "./CreatorBadge";
import SettingsPopup from "./SettingsPopup";
import styles from "./TradePanel.module.css";
import TradePanelBufferWarning from "./TradePanelBufferWarning";
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
import { useIsGeoBlocked } from "../../hooks/useIsGeoBlocked";
import { useIsMintPaused } from "../../hooks/useLeveragedTokens";
import { useLiveTradeQuote } from "../../hooks/useLiveTradeQuote";
import { useReferral } from "../../hooks/useReferral";
import { useSlippage } from "../../hooks/useSlippage";
import { useTradeRouter } from "../../hooks/useTradeRouter";
import { useWallet } from "../../hooks/useWallet";
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
const hyperEvmClient = createPublicClient({
  chain: hyperEVM,
  transport: http(rpcUrl),
});

// "Low balance" thresholds for the contextual bridge / get-gas CTAs.
// USDC: anything below the platform-wide minimum buy means the user can't
// place any meaningful trade without bridging more in, so we surface the
// bridge button proactively (not just on `insufficientUsdc` for a typed
// amount).
// HYPE: 0.005 HYPE (~$0.25 at $50/HYPE) covers ~20 trade-flow txs at
// typical HyperEVM gas prices (~0.5 gwei × ~500k gas per Zap.buy with
// approval). Below that we nudge the user to top up gas before their
// next signed tx fails with "insufficient funds for intrinsic gas".
const LOW_USDC_THRESHOLD = MIN_USDC_BUY_AMOUNT;
const LOW_HYPE_THRESHOLD_WEI = parseUnits("0.005", 18);

interface Props {
  token: Token;
  /**
   * Drop the outer `.panel` chrome (background / border / fixed width /
   * shadow) so the panel can be embedded inside another container that
   * already owns those — specifically the mobile trade modal, which uses
   * `shared/Modal` for the surface and would otherwise double up borders.
   * The internal toggle / form / CTA layout is unchanged.
   */
  chromeless?: boolean;
}

export default function TradePanel({ token, chromeless = false }: Props) {
  // While BounceTech has paused minting on the backing LT every `Zap.buy`
  // for this token reverts (Zap mints LT from USDC on every buy). Drives
  // the disabled-buy state plus the explainer banner below; sells continue
  // to work through `redeem`, which is what makes a sell-only market
  // preferable to freezing both sides — see AGENTS.md → "Mint-pause is
  // asymmetric (accepted)" for the contract-side rationale.
  const isMintPaused = useIsMintPaused(token.ltAddress);
  // Admin-hidden token (issue #712). Same buy-disabled / sell-open shape
  // as `isMintPaused`: the token has been pulled from the public
  // listings, but holders still need a way to exit their position. The
  // detail endpoint only serves a hidden row to a wallet that's already
  // proven (on-chain `balanceOf`) it holds the token, so the only way
  // to reach this branch is as a holder selling out.
  const isPolicyHidden = token.isHidden;
  // CDN-derived geo gate. Mirrors `isMintPaused` semantics — buys are
  // blocked, sells stay open so users in restricted regions can always
  // exit. Fail-open while the trace fetch is in flight (the hook returns
  // `false` until it resolves), so the form is never blocked on a slow
  // edge response.
  const { isGeoBlocked } = useIsGeoBlocked();
  // Admin-hidden tokens are sell-only by policy — start the form in sell
  // mode rather than blanking out a buy-mode panel with an explainer
  // and a disabled CTA. Mirrors the auto-switch effect for `isMintPaused`
  // below.
  const [mode, setMode] = useState<"buy" | "sell">(
    isPolicyHidden ? "sell" : "buy",
  );
  // Auto-swap to sell mode the first time we learn the LT is paused — and
  // only when the user hasn't typed anything yet, so we never clobber an
  // in-progress buy attempt. Tracked in a ref so toggling back to "buy"
  // manually doesn't trigger a second swap on the next refetch.
  const autoSwitchedToSellRef = useRef(false);
  const [amount, setAmount] = useState("");
  // Slippage is persisted across page loads and shared across tabs — see
  // `useSlippage` for the storage shape. Defaulting via the hook keeps the
  // chip-highlight logic in `SettingsPopup` stable on first render (no
  // post-mount jump from 2% → persisted value).
  const [slippage, setSlippage] = useSlippage();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [maxBalance, setMaxBalance] = useState<string | null>(null);
  const [maxBalanceWei, setMaxBalanceWei] = useState<bigint | null>(null);
  // USDC balance is tracked independently of `maxBalance` because the latter
  // swaps to the token balance in sell mode. We always want to know the
  // user's USDC balance so the buy-side insufficient-funds check works
  // regardless of which mode the panel is currently in.
  const [usdcBalance, setUsdcBalance] = useState<string | null>(null);
  // Native HYPE balance — drives the contextual "GET GAS" CTA. Stored as
  // wei so the threshold compare is an exact bigint < bigint check (no
  // float drift on tiny balances). `null` while the read is in flight or
  // the user is disconnected, which suppresses the CTA until we have a
  // real number to compare against.
  const [hypeBalanceWei, setHypeBalanceWei] = useState<bigint | null>(null);

  const { address } = useAccount();
  const { isConnected, connect } = useWallet();
  const referrer = useReferral();
  const { step, txHash, error, executeBuy, executeSell, reset } =
    useTradeRouter();
  const { pushToast } = useToast();
  // Snapshot of the trade-side amounts at submit time, consumed once when
  // the tx confirms. Held in a ref so the captured values don't get clobbered
  // by the post-confirm reset (`setAmount("")`, quote teardown) before the
  // toast effect runs.
  const pendingTradeRef = useRef<{
    mode: "buy" | "sell";
    tokenAmount: number;
    usdcAmount: number;
    ticker: string;
  } | null>(null);

  const amtNum = parseFloat(amount) || 0;

  // Live-refreshing quote: debounced on user input, throttled re-quote on
  // `trade` / `price` WS ticks so the "You receive ≈ …" estimate stays in
  // sync with the chart / mcap / price as other users trade and the LT
  // exchange rate drifts. See `useLiveTradeQuote` for the cadence model.
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
  // Insufficient USDC for buys. Only flag once the balance has loaded so we
  // don't disable the button during the initial fetch (or for users who
  // haven't connected — the wallet-connect CTA path takes priority).
  const usdcBalanceNum = usdcBalance !== null ? parseFloat(usdcBalance) : null;
  const insufficientUsdc =
    isConnected &&
    mode === "buy" &&
    amtNum > 0 &&
    usdcBalanceNum !== null &&
    amtNum > usdcBalanceNum;

  // Bridge-USDC CTA: surfaced in buy mode whenever the wallet either can't
  // meet the platform minimum buy at all, or can't cover the amount the
  // user just typed. Suppressed in sell mode (no USDC needed to exit) and
  // while balances are still loading. The link points at relay.link with
  // HyperEVM as the destination chain and USDC as the receive currency, so
  // a user can bridge in from any source chain in a single hop.
  const showBridgeUsdc =
    isConnected &&
    mode === "buy" &&
    usdcBalanceNum !== null &&
    (usdcBalanceNum < LOW_USDC_THRESHOLD || insufficientUsdc);

  // Get-Gas CTA: surfaced (in either trade mode) when the wallet's native
  // HYPE balance is below the gas-floor threshold. Hidden whenever the
  // bridge-USDC CTA is showing — they share the same vertical slot above
  // the BUY/SELL button and the USDC ask is the more pressing of the two
  // (no point topping up gas to send a buy you can't fund).
  const showGetGas =
    isConnected &&
    hypeBalanceWei !== null &&
    hypeBalanceWei < LOW_HYPE_THRESHOLD_WEI &&
    !showBridgeUsdc;

  const loadBalance = useCallback(async () => {
    if (!address) {
      setUsdcBalance(null);
      setHypeBalanceWei(null);
      return;
    }
    // Native HYPE — fed into the "GET GAS" CTA. Fired in parallel with the
    // USDC read (no `await` join needed here since each call updates its
    // own state slice independently). Wallet-side gas estimation will catch
    // a truly empty balance at signing time; this read just lets us prompt
    // the user to top up *before* they hit that wall.
    hyperEvmClient
      .getBalance({ address })
      .then((wei) => setHypeBalanceWei(wei))
      .catch(() => setHypeBalanceWei(null));
    // Always fetch USDC balance — the insufficient-funds guard must work in
    // both modes regardless of which balance `maxBalance` is currently
    // pointing at. In buy mode `maxBalance` IS the USDC balance, so we
    // reuse the same read for both.
    try {
      const usdcRaw = (await hyperEvmClient.readContract({
        address: ADDRESSES.usdc,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address],
      })) as bigint;
      const usdcFormatted = formatUnits(usdcRaw, USDC_DECIMALS);
      setUsdcBalance(usdcFormatted);

      if (mode === "buy") {
        setMaxBalance(usdcFormatted);
        setMaxBalanceWei(usdcRaw);
        return;
      }
    } catch {
      setUsdcBalance(null);
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
    // Auto-swap to sell mode the first time we learn either:
    //   1. The backing LT has been mint-paused by BounceTech, OR
    //   2. The token has been admin-hidden (policy violation).
    // Both render the panel as sell-only — the user can still toggle BUY
    // back to read the disabled state, but landing in sell mode skips
    // the click. Auto-switch is one-shot (the ref) and only fires while
    // the input is empty, so we never clobber an in-progress buy attempt.
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

  const doTrade = () => {
    if (!isConnected) {
      connect();
      return;
    }
    if (!amtNum) return;
    // Belt-and-braces: the BUY button is disabled while paused, but if
    // the user somehow lands here (race between paused-state polling and
    // a click) the tx would revert against BounceTech anyway, so bail out
    // cleanly without surfacing a wallet popup.
    if (isMintPaused && mode === "buy") return;
    // Same belt-and-braces for the geo gate — the button is disabled, but
    // a stale render between a country flip and the click shouldn't be
    // able to slip a tx through.
    if (isGeoBlocked && mode === "buy") return;
    // And again for the admin-hidden gate — buys are policy-blocked, so
    // refuse to broadcast even if a stale render leaks through.
    if (isPolicyHidden && mode === "buy") return;

    if (mode === "buy") {
      pendingTradeRef.current = {
        mode: "buy",
        tokenAmount: buyQuote?.tokensOutRaw ?? 0,
        usdcAmount: amtNum,
        ticker: token.ticker,
      };
      executeBuy(token.address, amtNum, slippage, referrer);
    } else {
      const parsed = parseUnits(amount, 18);
      const tokenAmountWei =
        maxBalanceWei !== null && parsed > maxBalanceWei
          ? maxBalanceWei
          : parsed;
      pendingTradeRef.current = {
        mode: "sell",
        tokenAmount: parseFloat(formatUnits(tokenAmountWei, 18)),
        usdcAmount: sellQuote?.usdcOut ?? 0,
        ticker: token.ticker,
      };
      executeSell(token.address, tokenAmountWei, slippage);
    }
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
    step === "approving" || step === "signing" || step === "executing";

  const buyDisabledByPause = isMintPaused && mode === "buy";
  const buyDisabledByGeo = isGeoBlocked && mode === "buy";
  const buyDisabledByPolicy = isPolicyHidden && mode === "buy";
  const geoBlockShown = buyDisabledByGeo && amtNum > 0;

  // Only one error/warning is rendered at a time so the form never stacks
  // a stale router error (e.g. "Transaction was rejected in your wallet")
  // on top of a fresh input-validation message. Priority, highest first:
  //   1. geoBlock     — hard CDN gate, supersedes everything
  //   2. exceedsBuffer — sell-side liquidity ceiling (rich warning box)
  //   3. insufficientUsdc — buy-side wallet balance
  //   4. belowMinimum / sellBelowMinimum — per-mode minimums
  //   5. router error — last-attempt failure; lowest because it's the
  //      stalest signal and is cleared on the next amount edit anyway.
  //
  // Suppressed entirely while a tx is in flight or has just confirmed:
  // input-validation guards are pre-submission constraints, so showing them
  // mid-tx is noise. In particular, the post-confirm `loadBalance()` debits
  // USDC before `amount` is cleared, which would otherwise flash a stale
  // "Insufficient USDC" banner directly above the "Transaction confirmed"
  // box for the 3s lifetime of the success state.
  type ActiveError =
    | { kind: "geoBlock" }
    | { kind: "exceedsBuffer" }
    | { kind: "insufficientUsdc" }
    | { kind: "belowMinimum" }
    | { kind: "sellBelowMinimum" }
    | { kind: "txError"; message: string };
  const suppressValidation = isBusy || step === "confirmed";
  const activeError: ActiveError | null = (() => {
    if (suppressValidation) return null;
    if (geoBlockShown) return { kind: "geoBlock" };
    if (sellExceedsBuffer && sellQuote) return { kind: "exceedsBuffer" };
    if (insufficientUsdc) return { kind: "insufficientUsdc" };
    if (belowMinimum) return { kind: "belowMinimum" };
    if (sellBelowMinimum) return { kind: "sellBelowMinimum" };
    if (error) return { kind: "txError", message: error };
    return null;
  })();

  // Clear the router error as soon as the user edits the amount, so a
  // rejected/cancelled tx from a previous attempt doesn't linger while
  // the user is dialing in a new amount. Wrapped here (instead of an
  // effect on `amount`) so we only fire on actual user input — mode
  // toggles already call `reset()` themselves and shouldn't double-fire.
  const handleAmountChange = useCallback(
    (next: string) => {
      setAmount(next);
      if (step === "error") reset();
    },
    [step, reset],
  );

  // The label is intentionally minimal: anything that has a dedicated
  // error/status surface above the button (paused banner, minimum-amount
  // / insufficient-funds / buffer / geo-block error boxes) is *not*
  // duplicated here — the button just renders disabled with the default
  // BUY/SELL label so the same message isn't shown twice on screen. Only
  // labels with no above-the-button equivalent stay (the connect CTA and
  // the live tx-progress states).
  const buttonLabel = () => {
    if (!isConnected) return "CONNECT WALLET";
    if (step === "signing") return "SIGN IN WALLET…";
    if (step === "approving")
      return mode === "sell" ? "APPROVING TOKEN…" : "APPROVING USDC…";
    if (step === "executing") return mode === "buy" ? "BUYING…" : "SELLING…";
    if (step === "confirmed") return "CONFIRMED";
    if (step === "error") return "RETRY";
    return `${mode === "buy" ? "BUY" : "SELL"} ${token.name}`;
  };

  const ticker = token.ticker;
  const panelClass = cn(styles.panel, chromeless && styles.panelChromeless);

  // Token is in the contract-frozen graduating window (phase 1 of the
  // two-phase graduation has fired; awaiting the keeper's `finalizeGraduation`
  // call). Both `Zap.buy` and `Zap.sell` would revert with `TokenIsGraduating`
  // here, so render a read-only overlay instead of the form. The token-detail
  // hook polls/subscribes to the API's `graduation` WS channel, so this
  // automatically transitions to the post-grad UI when phase 2 lands.
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
            disabled={isMintPaused || isPolicyHidden}
            onClick={() => {
              setMode("buy");
              setAmount("");
              reset();
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
            onClick={() => {
              setMode("sell");
              setAmount("");
              reset();
            }}
          >
            SELL
          </SegmentedButton>
        </div>

        <div className={styles.gearWrap}>
          <IconButton
            active={settingsOpen}
            onClick={() => setSettingsOpen(!settingsOpen)}
            aria-label="Trade settings"
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
        {/* `isPolicyHidden` takes precedence over `isMintPaused` because
         *  the policy ban is the more severe state — the token won't
         *  come back even if BounceTech unfreezes minting. Sells stay
         *  open in both cases. */}
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
          sellQuote={sellQuote}
          token={token}
        />

        {isConnected && mode === "buy" && (
          <div className={styles.balanceRow}>
            <span className={styles.balanceLabel}>USDC balance</span>
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
            <span className={styles.balanceLabel}>{ticker} balance</span>
            <span className={styles.balanceValue}>
              {maxBalance !== null
                ? `${formatTokenAmount(parseFloat(maxBalance))} ${ticker}`
                : "—"}
            </span>
          </div>
        )}

        {amtNum > 0 && (
          <TradePanelQuote
            mode={mode}
            ticker={ticker}
            buyQuote={buyQuote}
            sellQuote={sellQuote}
          />
        )}

        {/* Single error/warning slot — priority resolved in `activeError`
            above. Stacking multiple messages here (e.g. a stale router
            error alongside a fresh "below minimum") was confusing and
            duplicated the disable rationale for the CTA button. */}
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

        {/* Bridge / get-gas CTA. Sits directly above the BUY/SELL primary
            so the actionable next step is immediately adjacent to the
            (now-disabled) trade button. Suppressed mid-tx and right after
            a confirm so the success box / busy state isn't visually
            competing with a "go bridge instead" prompt. The two cases are
            mutually exclusive (`showGetGas` requires `!showBridgeUsdc`),
            so at most one renders. */}
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
            (isConnected && amtNum <= 0)
          }
          className={step === "confirmed" ? styles.ctaConfirmed : undefined}
          onClick={doTrade}
        >
          {buttonLabel()}
        </Button>

        {isBusy && (
          <div className={styles.busyHint}>
            <div className={styles.liveDot} />
            {step === "signing"
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
