import { useState, useEffect, useCallback, useRef } from "react";

import { MIN_USDC_BUY_AMOUNT, MIN_USDC_SELL_AMOUNT } from "@launchpad/shared";
import { createPublicClient, formatUnits, http, parseUnits } from "viem";
import { useAccount } from "wagmi";

import CreatorBadge from "./CreatorBadge";
import SettingsPopup from "./SettingsPopup";
import styles from "./TradePanel.module.css";
import TradePanelBufferWarning from "./TradePanelBufferWarning";
import TradePanelFooter from "./TradePanelFooter";
import TradePanelInput from "./TradePanelInput";
import TradePanelQuote from "./TradePanelQuote";
import { hyperEVM } from "../../config/chains";
import { erc20Abi } from "../../contracts/abis";
import { ADDRESSES, USDC_DECIMALS } from "../../contracts/addresses";
import { useReferral } from "../../hooks/useReferral";
import { useTradeRouter } from "../../hooks/useTradeRouter";
import { useWallet } from "../../hooks/useWallet";
import { tradeRouterService } from "../../services/tradeRouter";
import { cn, formatTokenAmount, formatUsd, shortenAddress } from "../../utils/format";
import Button from "../shared/Button";
import { buildTxAction, useToast } from "../shared/Toast";

import type { BuyQuote, SellQuote } from "../../services/tradeRouter";
import type { Token } from "../../services/types";

const rpcUrl = import.meta.env.VITE_RPC_URL || "https://rpc.hyperliquid.xyz/evm";
const hyperEvmClient = createPublicClient({
  chain: hyperEVM,
  transport: http(rpcUrl),
});

interface Props {
  token: Token;
}

export default function TradePanel({ token }: Props) {
  const [mode, setMode] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState(0.02);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [buyQuote, setBuyQuote] = useState<BuyQuote | null>(null);
  const [sellQuote, setSellQuote] = useState<SellQuote | null>(null);
  const [maxBalance, setMaxBalance] = useState<string | null>(null);
  const [maxBalanceWei, setMaxBalanceWei] = useState<bigint | null>(null);
  // USDC balance is tracked independently of `maxBalance` because the latter
  // swaps to the token balance in sell mode. We always want to know the
  // user's USDC balance so the buy-side insufficient-funds check works
  // regardless of which mode the panel is currently in.
  const [usdcBalance, setUsdcBalance] = useState<string | null>(null);

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
  const pendingTradeRef = useRef<
    | {
        mode: "buy" | "sell";
        tokenAmount: number;
        usdcAmount: number;
        ticker: string;
      }
    | null
  >(null);

  const amtNum = parseFloat(amount) || 0;

  const usdcAmount = mode === "buy"
    ? amtNum
    : (sellQuote ? sellQuote.usdcOut : 0);

  const belowMinimum = amtNum > 0 && mode === "buy" && usdcAmount < MIN_USDC_BUY_AMOUNT;
  const sellBelowMinimum = amtNum > 0 && mode === "sell" && sellQuote != null && sellQuote.usdcOut < MIN_USDC_SELL_AMOUNT;
  const sellExceedsBuffer = amtNum > 0 && mode === "sell" && sellQuote != null && sellQuote.exceedsBuffer;
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

  useEffect(() => {
    if (!amtNum || amtNum <= 0) {
      setBuyQuote(null);
      setSellQuote(null);
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      try {
        if (mode === "buy") {
          const quote = await tradeRouterService.getQuoteBuy(token.address, amtNum);
          if (!controller.signal.aborted) setBuyQuote(quote);
        } else {
          const quote = await tradeRouterService.getQuoteSell(token.address, amtNum, slippage, token.leverage);
          if (!controller.signal.aborted) setSellQuote(quote);
        }
      } catch {
        // Quote failed, will show no estimate
      }
    }, 300);

    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, [amtNum, mode, token.address, token.leverage, slippage]);

  const loadBalance = useCallback(async () => {
    if (!address) {
      setUsdcBalance(null);
      return;
    }
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

  const doTrade = () => {
    if (!isConnected) {
      connect();
      return;
    }
    if (!amtNum) return;

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
        maxBalanceWei !== null && parsed > maxBalanceWei ? maxBalanceWei : parsed;
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

  const isBusy = step === "approving" || step === "signing" || step === "executing";

  const buttonLabel = () => {
    if (!isConnected) return "CONNECT WALLET";
    if (belowMinimum) return `MINIMUM $${MIN_USDC_BUY_AMOUNT} USDC`;
    if (sellBelowMinimum) return `MINIMUM $${MIN_USDC_SELL_AMOUNT} USDC`;
    if (sellExceedsBuffer) return "EXCEEDS AVAILABLE LIQUIDITY";
    if (insufficientUsdc) return "INSUFFICIENT USDC";
    if (step === "signing") return "SIGN IN WALLET…";
    if (step === "approving") return mode === "sell" ? "APPROVING TOKEN…" : "APPROVING USDC…";
    if (step === "executing") return mode === "buy" ? "BUYING…" : "SELLING…";
    if (step === "confirmed") return "CONFIRMED";
    if (step === "error") return "RETRY";
    return `${mode === "buy" ? "BUY" : "SELL"} ${token.name}`;
  };

  const ticker = token.ticker;
  const is5x = token.leverage === 5;

  // Token is in the contract-frozen graduating window (phase 1 of the
  // two-phase graduation has fired; awaiting the keeper's `finalizeGraduation`
  // call). Both `Zap.buy` and `Zap.sell` would revert with `TokenIsGraduating`
  // here, so render a read-only overlay instead of the form. The token-detail
  // hook polls/subscribes to the API's `graduation` WS channel, so this
  // automatically transitions to the post-grad UI when phase 2 lands.
  if (token.status === "graduating") {
    return (
      <div className={styles.panel}>
        <div className={styles.graduatingPanel}>
          <div className={styles.graduatingSpinner} />
          <div className={styles.graduatingTitle}>Token is graduating</div>
          <div className={styles.graduatingBody}>
            No buys or sells allowed during this period.
          </div>
          <div className={styles.graduatingHint}>
            Usually under 2 minutes — please wait while liquidity is seeded on HyperSwap.
          </div>
        </div>
        <CreatorBadge token={token} />
        <TradePanelFooter token={token} />
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      {is5x && (
        <div className={styles.volWarning}>
          ⚠ 5× leverage — significantly more volatility decay, recommended for short-term
        </div>
      )}

      <div className={styles.toggleBar}>
        <div className={styles.toggleGrid}>
          <button
            className={cn(
              styles.modeBtn,
              mode === "buy" && styles.modeBtnBuyActive,
            )}
            onClick={() => {
              setMode("buy");
              setAmount("");
              reset();
            }}
          >
            BUY
            {mode === "buy" && <span className={styles.modeIndicatorMint} />}
          </button>
          <button
            className={cn(
              styles.modeBtn,
              mode === "sell" && styles.modeBtnSellActive,
            )}
            onClick={() => {
              setMode("sell");
              setAmount("");
              reset();
            }}
          >
            SELL
            {mode === "sell" && <span className={styles.modeIndicatorRed} />}
          </button>
        </div>

        <div className={styles.gearWrap}>
          <button
            className={cn(styles.gearBtn, settingsOpen && styles.gearBtnActive)}
            onClick={() => setSettingsOpen(!settingsOpen)}
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
            >
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>

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
        <TradePanelInput
          mode={mode}
          amount={amount}
          setAmount={setAmount}
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

        {sellExceedsBuffer && sellQuote && (
          <TradePanelBufferWarning sellQuote={sellQuote} ticker={ticker} />
        )}

        {belowMinimum && (
          <div className={styles.errorBox}>
            <span className={styles.errorIcon}>⚠</span>
            Minimum buy is ${MIN_USDC_BUY_AMOUNT} USDC
          </div>
        )}

        {sellBelowMinimum && (
          <div className={styles.errorBox}>
            <span className={styles.errorIcon}>⚠</span>
            Minimum sell is ${MIN_USDC_SELL_AMOUNT} USDC
          </div>
        )}

        {insufficientUsdc && (
          <div className={styles.errorBox}>
            <span className={styles.errorIcon}>⚠</span>
            Insufficient USDC — wallet holds $
            {parseFloat(usdcBalance ?? "0").toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </div>
        )}

        {error && (
          <div className={styles.errorBox}>
            <span className={styles.errorIcon}>⚠</span>
            {error}
          </div>
        )}

        {step === "confirmed" && txHash && (
          <div className={styles.confirmedBox}>
            <span>✓ Transaction confirmed</span>
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

        <Button
          variant={mode === "buy" ? "primary" : "danger"}
          fullWidth
          busy={isBusy}
          disabled={
            step === "confirmed" ||
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

      <TradePanelFooter token={token} />
    </div>
  );
}
