import { useState, useEffect, useCallback } from "react";

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
import { cn, formatCurveFilled, shortenAddress } from "../../utils/format";
import Button from "../shared/Button";

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

  const { address } = useAccount();
  const { isConnected, connect } = useWallet();
  const referrer = useReferral();
  const { step, txHash, error, executeBuy, executeSell, reset } =
    useTradeRouter();

  const amtNum = parseFloat(amount) || 0;

  const usdcAmount = mode === "buy"
    ? amtNum
    : (sellQuote ? sellQuote.usdcOut : 0);

  const belowMinimum = amtNum > 0 && mode === "buy" && usdcAmount < MIN_USDC_BUY_AMOUNT;
  const sellBelowMinimum = amtNum > 0 && mode === "sell" && sellQuote != null && sellQuote.usdcOut < MIN_USDC_SELL_AMOUNT;
  const sellExceedsBuffer = amtNum > 0 && mode === "sell" && sellQuote != null && sellQuote.exceedsBuffer;

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
          const quote = await tradeRouterService.getQuoteSell(token.address, amtNum);
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
  }, [amtNum, mode, token.address]);

  const loadBalance = useCallback(async () => {
    if (!address) return;
    try {
      if (mode === "buy") {
        const balance = await hyperEvmClient.readContract({
          address: ADDRESSES.usdc,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address],
        }) as bigint;
        setMaxBalance(formatUnits(balance, USDC_DECIMALS));
        setMaxBalanceWei(balance);
      } else {
        const balance = await hyperEvmClient.readContract({
          address: token.address as `0x${string}`,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address],
        }) as bigint;
        setMaxBalance(formatUnits(balance, 18));
        setMaxBalanceWei(balance);
      }
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
      executeBuy(token.address, amtNum, slippage, referrer);
    } else {
      const parsed = parseUnits(amount, 18);
      const tokenAmountWei =
        maxBalanceWei !== null && parsed > maxBalanceWei ? maxBalanceWei : parsed;
      executeSell(token.address, tokenAmountWei, slippage);
    }
  };

  useEffect(() => {
    if (step === "confirmed") {
      loadBalance();
      const t = setTimeout(() => {
        reset();
        setAmount("");
      }, 3000);
      return () => clearTimeout(t);
    }
  }, [step, reset, loadBalance]);

  const isBusy = step === "approving" || step === "executing";

  const buttonLabel = () => {
    if (!isConnected) return "CONNECT WALLET";
    if (belowMinimum) return `MINIMUM $${MIN_USDC_BUY_AMOUNT} USDC`;
    if (sellBelowMinimum) return `MINIMUM $${MIN_USDC_SELL_AMOUNT} USDC`;
    if (sellExceedsBuffer) return "EXCEEDS AVAILABLE LIQUIDITY";
    if (step === "approving") return mode === "sell" ? "APPROVING TOKEN…" : "APPROVING USDC…";
    if (step === "executing") return mode === "buy" ? "BUYING…" : "SELLING…";
    if (step === "confirmed") return "CONFIRMED";
    if (step === "error") return "RETRY";
    return `${mode === "buy" ? "BUY" : "SELL"} ${token.name}`;
  };

  const ticker = token.ticker;
  const is5x = token.leverage === 5;

  return (
    <div className={styles.panel}>
      {is5x && (
        <div className={styles.volWarning}>
          ⚠ 5× leverage — significantly more volatility decay, recommended for short-term
        </div>
      )}

      {token.status === "graduating" && (
        <div className={styles.graduatingBanner}>
          <div className={styles.bannerDot} />
          graduating · {formatCurveFilled(token.curveFilled)} progress
          <div className={styles.bannerDot} />
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
              <circle cx="12" cy="12" r="3" />
              <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
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
          disabled={step === "confirmed" || belowMinimum || sellBelowMinimum || sellExceedsBuffer}
          className={step === "confirmed" ? styles.ctaConfirmed : undefined}
          onClick={doTrade}
        >
          {buttonLabel()}
        </Button>

        {isBusy && (
          <div className={styles.busyHint}>
            <div className={styles.liveDot} />
            {step === "approving"
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
