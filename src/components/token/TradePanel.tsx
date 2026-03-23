import { useState, useEffect } from "react";

import CreatorBadge from "./CreatorBadge";
import SettingsPopup from "./SettingsPopup";
import styles from "./TradePanel.module.css";
import { FEES, MOCK_TOKEN_PRICE, QUICK_AMOUNTS } from "../../config/constants";
import { useCopyState } from "../../hooks/useCopyState";
import { useTradeRouter } from "../../hooks/useTradeRouter";
import { useWallet } from "../../hooks/useWallet";
import { cn } from "../../utils/format";

import type { Token } from "../../services/types";

interface Props {
  token: Token;
}

export default function TradePanel({ token }: Props) {
  const [mode, setMode] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [denomUsdc, setDenomUsdc] = useState(true);
  const [slippage, setSlippage] = useState(0.02);
  const { copied, copy: copyCA } = useCopyState();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const { isConnected, connect } = useWallet();
  const { step, txHash, error, executeTrade, reset } = useTradeRouter();

  const amtNum = parseFloat(amount) || 0;

  const mockPrice = MOCK_TOKEN_PRICE;
  const sellFeeMultiplier = 1 - FEES.curveSell - FEES.ltRedemption * 2;
  const usdcIn = denomUsdc ? amtNum : amtNum * mockPrice;
  const estimateTokens = usdcIn / mockPrice;
  const tokensIn = denomUsdc ? amtNum / mockPrice : amtNum;
  const estimateUsdc = tokensIn * mockPrice * sellFeeMultiplier;

  const doTrade = () => {
    if (!isConnected) {
      connect();
      return;
    }
    if (!amtNum) return;

    const tradeAmount =
      mode === "buy"
        ? denomUsdc ? amtNum : amtNum * mockPrice
        : denomUsdc ? amtNum / mockPrice : amtNum;
    executeTrade(token.address, tradeAmount, slippage);
  };

  useEffect(() => {
    if (step === "confirmed") {
      const t = setTimeout(() => {
        reset();
        setAmount("");
      }, 3000);
      return () => clearTimeout(t);
    }
  }, [step, reset]);

  const isBusy = step === "approving" || step === "executing";

  const buttonLabel = () => {
    if (!isConnected) return "CONNECT WALLET";
    if (step === "approving") return "APPROVING USDC…";
    if (step === "executing") return mode === "buy" ? "BUYING…" : "SELLING…";
    if (step === "confirmed") return "✓ CONFIRMED";
    if (step === "error") return "RETRY";
    return `${mode === "buy" ? "BUY" : "SELL"} ${token.name}`;
  };

  const ticker = token.ticker;

  return (
    <div className={styles.panel}>
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
        <button
          className={styles.denomToggle}
          onClick={() => {
            setDenomUsdc(!denomUsdc);
            setAmount("");
          }}
        >
          Switch to {denomUsdc ? ticker : "USDC"}
        </button>

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
              {denomUsdc ? "USDC" : ticker}
            </span>
            <div
              className={cn(
                styles.coinIcon,
                denomUsdc
                  ? styles.coinUsdc
                  : mode === "buy"
                    ? styles.coinMint
                    : styles.coinRed,
              )}
            >
              {denomUsdc ? (
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
                setDenomUsdc(true);
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
              setDenomUsdc(true);
              setAmount("4210");
            }}
            disabled={isBusy}
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
                  {estimateTokens.toLocaleString(undefined, {
                    maximumFractionDigits: 0,
                  })}
                </span>{" "}
                <span className={styles.estimateMint}>{ticker}</span>
              </>
            ) : (
              <>
                ≈ you receive{" "}
                <span className={styles.estimateValue}>
                  $
                  {estimateUsdc.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>{" "}
                <span className={styles.estimateLabel}>USDC</span>
              </>
            )}
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
          disabled={isBusy || step === "confirmed"}
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
