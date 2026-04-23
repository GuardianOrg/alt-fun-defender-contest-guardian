import { useState } from "react";

import styles from "./SeedBuy.module.css";
import StepHeader from "./StepHeader";
import { SEED_PCT_OPTIONS } from "../../config/constants";
import { useGraduationThreshold } from "../../hooks/useGraduationThreshold";
import { cn } from "../../utils/format";
import { seedBuyStats, usdcForSupplyPct } from "../../utils/seedBuyMath";

interface Props {
  seedAmount: string;
  onSeedChange: (v: string) => void;
}

export default function SeedBuy({ seedAmount, onSeedChange }: Props) {
  const [activePct, setActivePct] = useState<number | null>(null);
  const amt = parseFloat(seedAmount) || 0;

  // Use the compile-time fallback while loading so the curve-filled %
  // renders something sensible immediately instead of `Infinity`/skeleton.
  // The hook resolves in <100ms for warm wallets — if the admin has tuned
  // the dial the value will swap in a tick later.
  const { data: graduationThresholdUsd, fallback } = useGraduationThreshold();
  const stats = seedBuyStats(amt, graduationThresholdUsd ?? fallback);

  const tokensReceived =
    amt > 0 ? `${(stats.tokensReceived / 1e6).toFixed(1)}M` : "—";
  const supplyStr = amt > 0 ? `${stats.supplyPct.toFixed(1)}%` : "—";
  const curveStr = amt > 0 ? `${stats.curveFilled.toFixed(1)}%` : "—";

  return (
    <div>
      <StepHeader
        step={3}
        title="Seed buy"
        subtitle="Buy tokens before anyone else. Sets the opening price."
      />

      <div className={styles.card}>
        <div className={styles.amountRow}>
          <span className={styles.dollarSign}>$</span>
          <input
            type="number"
            className={styles.amountInput}
            placeholder="0.00"
            value={seedAmount}
            onChange={(e) => {
              onSeedChange(e.target.value);
              setActivePct(null);
            }}
            min="0"
          />
        </div>

        <div className={styles.quickGrid}>
          {SEED_PCT_OPTIONS.map((pct) => {
            const usd = usdcForSupplyPct(pct);
            return (
              <button
                key={pct}
                className={cn(
                  styles.quickButton,
                  activePct === pct
                    ? styles.quickButtonActive
                    : styles.quickButtonInactive,
                )}
                onClick={() => {
                  onSeedChange(Math.ceil(usd).toString());
                  setActivePct(pct);
                }}
              >
                <div className={styles.quickLabel}>{pct}%</div>
                <div className={styles.quickSub}>
                  ${Math.ceil(usd).toLocaleString()}
                </div>
              </button>
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

      {amt <= 0 && (
        <div className={styles.skipHint}>
          Skip this step to launch with zero initial buy
        </div>
      )}
    </div>
  );
}
