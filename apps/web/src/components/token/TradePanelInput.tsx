import { formatUnits, parseUnits } from "viem";

import styles from "./TradePanel.module.css";
import { QUICK_AMOUNTS, SELL_PERCENT_OPTIONS } from "../../config/constants";
import { cn } from "../../utils/format";
import { srcSetFor, transformImageUrl } from "../../utils/image";
import { tierFor } from "../../utils/vanityTier";
import VanityEffect from "../effects/VanityEffect";
import UsdcIcon from "../icons/UsdcIcon";
import PresetChip from "../shared/PresetChip";

import type { SellQuote } from "../../services/tradeRouter";
import type { Token } from "../../services/types";

interface Props {
  mode: "buy" | "sell";
  amount: string;
  setAmount: (value: string) => void;
  isBusy: boolean;
  maxBalance: string | null;
  /**
   * Raw wei balance, used by the sell-side percent chips so 100% routes a
   * string that round-trips exactly through `parseUnits(amount, 18)`.
   * Going through `parseFloat(maxBalance)` drops ~3 trailing wei digits
   * (doubles hold ~16 sig figs vs. 18-decimal tokens), which lands the
   * 100% click a few units above `maxBalanceWei` and re-trips the
   * insufficient-balance guard in `TradePanel`.
   */
  maxBalanceWei: bigint | null;
  sellQuote: SellQuote | null;
  token: Token;
}

export default function TradePanelInput({
  mode,
  amount,
  setAmount,
  isBusy,
  maxBalance,
  maxBalanceWei,
  sellQuote,
  token,
}: Props) {
  const ticker = token.ticker;
  const vanityTier = tierFor(token.address);
  const coinIcon = (
    <div
      className={cn(
        styles.coinIcon,
        mode === "buy" ? styles.coinUsdc : styles.coinRed,
      )}
    >
      {mode === "buy" ? (
        <UsdcIcon className={styles.coinImg} />
      ) : token.image ? (
        <img
          src={transformImageUrl(token.image, { width: 32 })}
          srcSet={srcSetFor(token.image, 32) || undefined}
          alt=""
          width={32}
          height={32}
          className={styles.coinImg}
          decoding="async"
        />
      ) : (
        token.emoji
      )}
    </div>
  );

  return (
    <>
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
          {mode === "sell" && vanityTier.id !== "none" ? (
            <VanityEffect tier={vanityTier} size="icon" as="inline">
              {coinIcon}
            </VanityEffect>
          ) : (
            coinIcon
          )}
        </div>
      </div>

      <div className={styles.quickRow}>
        <PresetChip onClick={() => setAmount("")} disabled={isBusy}>
          Reset
        </PresetChip>
        {mode === "buy" ? (
          QUICK_AMOUNTS.map((qa) => (
            <PresetChip
              key={qa}
              fluid
              active={amount === String(qa)}
              onClick={() => {
                setAmount(String(qa));
              }}
              disabled={isBusy}
            >
              {qa >= 1000 ? `${qa / 1000}K` : qa}
            </PresetChip>
          ))
        ) : (
          SELL_PERCENT_OPTIONS.map((pct) => {
            // Percent math in bigint against `maxBalanceWei` so 100%
            // round-trips exactly through the `parseUnits(amount, 18)`
            // check in `TradePanel`. The previous parseFloat-based path
            // lost ~3 trailing wei (16-sig-fig double vs. 18-decimal
            // token), landing 100% one ULP above the wallet balance and
            // re-tripping the insufficient-balance guard.
            const computedValue =
              maxBalanceWei !== null
                ? (() => {
                    let resultWei = (maxBalanceWei * BigInt(pct)) / 100n;
                    // `maxSellableTokens` is a float (LT-buffer cap); convert
                    // to wei conservatively via `toFixed(18)` so the bigint
                    // min is exact. Wrapped in try/catch because `toFixed`
                    // on an extreme float can yield a string `parseUnits`
                    // rejects — in that case fall through to the unclamped
                    // balance percent rather than disabling the chip.
                    if (
                      sellQuote &&
                      Number.isFinite(sellQuote.maxSellableTokens)
                    ) {
                      try {
                        const capWei = parseUnits(
                          sellQuote.maxSellableTokens.toFixed(18),
                          18,
                        );
                        if (capWei < resultWei) resultWei = capWei;
                      } catch {
                        // Ignored.
                      }
                    }
                    return formatUnits(resultWei, 18);
                  })()
                : null;
            return (
              <PresetChip
                key={pct}
                fluid
                active={
                  computedValue !== null && amount === computedValue
                }
                onClick={() => {
                  if (computedValue !== null) {
                    setAmount(computedValue);
                  }
                }}
                disabled={isBusy || maxBalanceWei === null}
              >
                {pct}%
              </PresetChip>
            );
          })
        )}
        {mode === "buy" && (
          <PresetChip
            className={styles.maxBtn}
            onClick={() => {
              if (maxBalance) {
                const walletBal = parseFloat(maxBalance);
                setAmount(String(Math.floor(walletBal * 100) / 100));
              }
            }}
            disabled={isBusy || !maxBalance}
          >
            Max
          </PresetChip>
        )}
      </div>
    </>
  );
}
