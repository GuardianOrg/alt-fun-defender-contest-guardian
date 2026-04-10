import { useState, useEffect, useCallback } from "react";

import { MIN_USDC_AMOUNT } from "@launchpad/shared";
import { formatUnits, parseUnits } from "viem";
import { useAccount, usePublicClient } from "wagmi";

import CreatorBadge from "./CreatorBadge";
import SettingsPopup from "./SettingsPopup";
import styles from "./TradePanel.module.css";
import { QUICK_AMOUNTS } from "../../config/constants";
import { erc20Abi } from "../../contracts/abis";
import { ADDRESSES, USDC_DECIMALS } from "../../contracts/addresses";
import { useCopyState } from "../../hooks/useCopyState";
import { useReferral } from "../../hooks/useReferral";
import { useTradeRouter } from "../../hooks/useTradeRouter";
import { useWallet } from "../../hooks/useWallet";
import { tradeRouterService } from "../../services/tradeRouter";
import { cn } from "../../utils/format";

import type { BuyQuote, SellQuote } from "../../services/tradeRouter";
import type { Token } from "../../services/types";

interface Props {
  token: Token;
}

export default function TradePanel({ token }: Props) {
  const [mode, setMode] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState(0.02);
  const { copied, copy: copyCA } = useCopyState();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [buyQuote, setBuyQuote] = useState<BuyQuote | null>(null);
  const [sellQuote, setSellQuote] = useState<SellQuote | null>(null);
  const [maxBalance, setMaxBalance] = useState<string | null>(null);

  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { isConnected, connect } = useWallet();
  const referrer = useReferral();
  const { step, txHash, error, executeBuy, executeSell, reset } =
    useTradeRouter();

  const amtNum = parseFloat(amount) || 0;

  const usdcAmount = mode === "buy"
    ? amtNum
    : (sellQuote ? sellQuote.usdcOut : 0);

  const belowMinimum = amtNum > 0 && mode === "buy" && usdcAmount < MIN_USDC_AMOUNT;
  const sellBelowMinimum = amtNum > 0 && mode === "sell" && sellQuote != null && sellQuote.usdcOut < MIN_USDC_AMOUNT;

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
    if (!address || !publicClient) return;
    try {
      if (mode === "buy") {
        const balance = await publicClient.readContract({
          address: ADDRESSES.usdc,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address],
        }) as bigint;
        setMaxBalance(formatUnits(balance, USDC_DECIMALS));
      } else {
        const balance = await publicClient.readContract({
          address: token.address as `0x${string}`,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address],
        }) as bigint;
        setMaxBalance(formatUnits(balance, 18));
      }
    } catch {
      setMaxBalance(null);
    }
  }, [address, publicClient, mode, token.address]);

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
      const tokenAmountWei = parseUnits(amtNum.toFixed(18), 18);
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
    if (belowMinimum || sellBelowMinimum) return `MINIMUM $${MIN_USDC_AMOUNT} USDC`;
    if (step === "approving") return "APPROVING USDC…";
    if (step === "executing") return mode === "buy" ? "BUYING…" : "SELLING…";
    if (step === "confirmed") return "✓ CONFIRMED";
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
          graduating · {token.curveFilled}% filled
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
        <div className={styles.denomToggle}>
          {mode === "buy" ? "Amount in USDC" : `Amount in ${ticker}`}
        </div>

        <div className={styles.amountWrap}>
          <input
            className={styles.amountInput}
            type="number"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={isBusy}
          />
          <div className={styles.denomTag}>
            <span className={styles.denomLabel}>
              {mode === "buy" ? "USDC" : ticker}
            </span>
            <div
              className={cn(
                styles.coinIcon,
                mode === "buy" ? styles.coinUsdc : styles.coinRed,
              )}
            >
              {mode === "buy" ? (
                "$"
              ) : token.image ? (
                <img src={token.image} alt="" className={styles.coinImg} />
              ) : (
                token.emoji
              )}
            </div>
          </div>
        </div>

        <div className={styles.quickRow}>
          <button
            className={styles.resetBtn}
            onClick={() => setAmount("")}
            disabled={isBusy}
          >
            Reset
          </button>
          {QUICK_AMOUNTS.map((qa) => (
            <button
              key={qa}
              className={cn(
                styles.quickBtn,
                amount === String(qa) && styles.quickBtnActive,
              )}
              onClick={() => {
                setAmount(String(qa));
              }}
              disabled={isBusy}
            >
              {qa >= 1000 ? `${qa / 1000}K` : qa}
            </button>
          ))}
          <button
            className={styles.maxBtn}
            onClick={() => {
              if (maxBalance) {
                const truncated = parseFloat(maxBalance);
                setAmount(mode === "buy"
                  ? Math.floor(truncated * 100) / 100 + ""
                  : truncated.toString(),
                );
              }
            }}
            disabled={isBusy || !maxBalance}
          >
            Max
          </button>
        </div>

        {amtNum > 0 && (
          <div className={styles.estimate}>
            {mode === "buy" ? (
              <>
                ≈ you receive{" "}
                <span className={styles.estimateValue}>
                  {buyQuote?.tokensOut ?? "…"}
                </span>{" "}
                <span className={styles.estimateMint}>{ticker}</span>
                {buyQuote && buyQuote.priceImpactPct > 1 && (
                  <span className={styles.impactWarning}>
                    {" "}({buyQuote.priceImpactPct.toFixed(1)}% impact)
                  </span>
                )}
              </>
            ) : (
              <>
                ≈ you receive{" "}
                <span className={styles.estimateValue}>
                  ${sellQuote
                    ? sellQuote.youReceive.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })
                    : "…"}
                </span>{" "}
                <span className={styles.estimateLabel}>USDC</span>
                {sellQuote && sellQuote.priceImpactPct > 1 && (
                  <span className={styles.impactWarning}>
                    {" "}({sellQuote.priceImpactPct.toFixed(1)}% impact)
                  </span>
                )}
              </>
            )}
          </div>
        )}

        {(belowMinimum || sellBelowMinimum) && (
          <div className={styles.errorBox}>
            <span className={styles.errorIcon}>⚠</span>
            Minimum trade is ${MIN_USDC_AMOUNT} USDC (BounceTech LT requirement)
          </div>
        )}

        {error && (
          <div className={styles.errorBox}>
            <span className={styles.errorIcon}>⚠</span>
            {error}
          </div>
        )}

        {step === "confirmed" && txHash && (
          <div className={styles.confirmedBox}>✓ Transaction confirmed</div>
        )}

        <button
          className={cn(
            styles.ctaBtn,
            step === "confirmed"
              ? styles.ctaConfirmed
              : mode === "buy"
                ? styles.ctaBuy
                : styles.ctaSell,
            isBusy && styles.ctaBusy,
          )}
          onClick={doTrade}
          disabled={isBusy || step === "confirmed" || belowMinimum || sellBelowMinimum}
        >
          {buttonLabel()}
        </button>

        {isBusy && (
          <div className={styles.busyHint}>
            <div className={styles.liveDot} />
            {step === "approving"
              ? "Waiting for USDC approval in wallet…"
              : "Confirm transaction in wallet…"}
          </div>
        )}
      </div>

      <CreatorBadge token={token} />

      <div className={styles.footer}>
        <div className={styles.footerLeft}>
          <a className={styles.footerCa} onClick={() => copyCA(token.address)}>
            {copied
              ? "✓ copied"
              : `${token.address.slice(0, 6)}…${token.address.slice(-4)}`}
          </a>
          <span className={styles.footerDot}>·</span>
          <span className={styles.footerLt}>{token.ltName}</span>
        </div>
        <span
          className={cn(
            styles.footerStatus,
            token.status === "graduating"
              ? styles.footerStatusGraduating
              : styles.footerStatusDefault,
          )}
        >
          {token.status}
          {token.status === "graduating" ? " ⚡" : ""}
        </span>
      </div>
    </div>
  );
}
