import { useState } from "react";

import { MIN_USDC_BUY_AMOUNT } from "@launchpad/shared";

import styles from "./SeedBuy.module.css";
import StepHeader from "./StepHeader";
import { SEED_PCT_OPTIONS } from "../../config/constants";
import { cn } from "../../utils/format";
import { seedBuyStats, usdcForSupplyPct } from "../../utils/seedBuyMath";
import PresetChip from "../shared/PresetChip";

interface Props {
  seedAmount: string;
  onSeedChange: (v: string) => void;
}

export default function SeedBuy({ seedAmount, onSeedChange }: Props) {
  const [activePct, setActivePct] = useState<number | null>(null);
  const amt = parseFloat(seedAmount) || 0;

  const stats = seedBuyStats(amt);

  const tokensReceived =
    amt > 0 ? `${(stats.tokensReceived / 1e6).toFixed(1)}M` : "—";
  const supplyStr = amt > 0 ? `${stats.supplyPct.toFixed(1)}%` : "—";
  const curveStr = amt > 0 ? `${stats.curveFilled.toFixed(1)}%` : "—";

  // Mirrors `Zap.MIN_SEED_USDC` on-chain. The contract reverts with
  // `BelowMinSeed` if a launch tries to seed less than this; we surface the
  // floor in the UI so users never sign a reverting tx. See root
  // `AGENTS.md` § "Anti-snipe Design".
  const belowMinSeed = amt > 0 && amt < MIN_USDC_BUY_AMOUNT;
  const noSeed = amt <= 0;

  return (
    <div>
      <StepHeader
        step={3}
        title="Seed buy"
        subtitle={`Mandatory min $${MIN_USDC_BUY_AMOUNT}`}
      />

      <div className={styles.card}>
        <div className={styles.amountRow}>
          <span className={styles.dollarSign}>$</span>
          <input
            type="number"
            className={styles.amountInput}
            placeholder={`${MIN_USDC_BUY_AMOUNT}.00`}
            value={seedAmount}
            onChange={(e) => {
              onSeedChange(e.target.value);
              setActivePct(null);
            }}
            min={MIN_USDC_BUY_AMOUNT}
          />
        </div>

        <div className={styles.quickGrid}>
          {SEED_PCT_OPTIONS.map((pct) => {
            const usd = usdcForSupplyPct(pct);
            return (
              <PresetChip
                key={pct}
                active={activePct === pct}
                className={styles.quickButton}
                onClick={() => {
                  onSeedChange(Math.ceil(usd).toString());
                  setActivePct(pct);
                }}
              >
                <div className={styles.quickLabel}>{pct}%</div>
                <div className={styles.quickSub}>
                  ${Math.ceil(usd).toLocaleString()}
                </div>
              </PresetChip>
            );
          })}
        </div>

        <div className={styles.statsGrid}>
          {[
            { label: "tokens received", value: tokensReceived, cls: "" },
            { label: "% of supply", value: supplyStr, cls: styles.textMint },
            { label: "curve filled", value: curveStr, cls: "" },
          ].map((s) => (
            <div key={s.label} className={styles.statCard}>
              <div className={styles.statLabel}>{s.label}</div>
              <div className={cn(styles.statValue, s.cls)}>{s.value}</div>
            </div>
          ))}
        </div>
      </div>

      {noSeed && (
        <div className={styles.minHint}>
          Seed buy is required (min ${MIN_USDC_BUY_AMOUNT})
        </div>
      )}

      {belowMinSeed && (
        <div className={styles.minHint}>
          Seed buy must be at least ${MIN_USDC_BUY_AMOUNT}
        </div>
      )}
    </div>
  );
}
