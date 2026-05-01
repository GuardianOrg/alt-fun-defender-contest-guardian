import styles from "./VanityTierShowcase.module.css";
import {
  TIER_TABLE,
  VANITY_BASE_ZEROS,
  type VanityTier,
} from "../../utils/vanityTier";
import VanityEffect from "../effects/VanityEffect";

/**
 * Dev-only review page for the vanity tier visual system. Renders every
 * tier (including the base `none` tier) as it would appear in the four
 * places a tier surfaces in production:
 *   - homepage `<TokenRow>` (size="row")
 *   - token-detail `<HeroSection>` avatar (size="hero")
 *   - inline icon chip (size="icon", e.g. trade panel sell-side)
 *   - launch button on `/create` (size="button")
 *
 * Mounted at the unlinked route `/dev/tiers`. Strip the route + this
 * file once review is complete.
 */

/**
 * Build a synthetic 20-byte (40-hex-char) address with exactly `zeros`
 * trailing `0` chars. Used to drive the showcase: `tierFor(addr)`
 * computes the tier purely off this trailing-zero count, so each row
 * gets a representative address that lands in its target tier.
 */
function syntheticAddress(zeros: number): string {
  const FILLER = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0";
  const trim = Math.min(zeros, FILLER.length);
  return `0x${FILLER.slice(0, FILLER.length - trim)}${"0".repeat(trim)}`;
}

// Each tier's representative `total = base + minBonus` trailing-zero
// count, except `singularity` which we render at +12 (one above its
// minimum) so the visual is clearly past `cosmic`.
function totalZerosFor(tier: VanityTier): number {
  if (tier.id === "singularity") return 5 + 12;
  return 5 + tier.minBonus;
}

/**
 * Format a duration in seconds as a human-readable string.
 *
 * Picks the largest sensible unit. Below 1ms shows microseconds;
 * everything ≥ 1 year shows years (no centuries / millennia — at that
 * scale the precision-of-units gag breaks down and we just want a
 * single legible "X years" or "X million years").
 */
function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  if (seconds < 1e-6) return "<1µs";
  if (seconds < 1e-3) return `${(seconds * 1e6).toFixed(0)}µs`;
  if (seconds < 1) return `${(seconds * 1000).toFixed(0)}ms`;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${minutes.toFixed(minutes < 10 ? 1 : 0)}min`;
  const hours = minutes / 60;
  if (hours < 24) return `${hours.toFixed(hours < 10 ? 1 : 0)}h`;
  const days = hours / 24;
  if (days < 30) return `${days.toFixed(days < 10 ? 1 : 0)} days`;
  const months = days / 30.44;
  if (months < 12) return `${months.toFixed(1)} months`;
  const years = days / 365.25;
  if (years < 1000) return `${years.toFixed(years < 10 ? 1 : 0)} years`;
  if (years < 1e6) return `${(years / 1e3).toFixed(1)}k years`;
  if (years < 1e9) return `${(years / 1e6).toFixed(1)}M years`;
  return `${(years / 1e9).toFixed(1)}B years`;
}

/**
 * Format an integer attempt count (which can vastly exceed Number's
 * "safe integer" range — e.g. 16^17 ≈ 3e20). We compute in logarithmic
 * space and re-emit a coarse mantissa+exponent string for rough scale.
 */
function formatAttempts(zeros: number): string {
  if (zeros <= 0) return "1";
  // 16^N attempts on average for N trailing zeros.
  const log10 = zeros * Math.log10(16);
  const exp = Math.floor(log10);
  const mantissa = Math.pow(10, log10 - exp);
  if (exp < 3) return Math.pow(16, zeros).toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (exp < 6) return `${(mantissa * Math.pow(10, exp - 3)).toFixed(1)}K`;
  if (exp < 9) return `${(mantissa * Math.pow(10, exp - 6)).toFixed(1)}M`;
  if (exp < 12) return `${(mantissa * Math.pow(10, exp - 9)).toFixed(1)}B`;
  if (exp < 15) return `${(mantissa * Math.pow(10, exp - 12)).toFixed(1)}T`;
  return `${mantissa.toFixed(2)} × 10^${exp}`;
}

/**
 * Mining-rate anchors. The "your machine" rate matches what the
 * production worker pool actually achieves: ~6 cores running
 * `@noble/hashes` keccak in tight loops, observed at ~3M attempts/sec
 * total on a typical multi-core dev laptop. The "GPU cluster" rate
 * approximates a sustained ~100 high-end GPUs running a hand-tuned
 * native CUDA miner (e.g. profanity-style); a single RTX 4090 hits
 * ~1B keccak/sec on a tight kernel, a 100-GPU farm hits ~10^11/sec.
 */
const RATE_LOCAL_PER_SEC = 3_000_000;
const RATE_GPU_CLUSTER_PER_SEC = 1e11;

function meanSecondsForZeros(zeros: number, ratePerSec: number): number {
  // Mean attempts to find a salt with N trailing zeros = 16^N.
  // Compute in log space to avoid overflow at high N.
  const logAttempts = zeros * Math.log(16);
  const logSeconds = logAttempts - Math.log(ratePerSec);
  return Math.exp(logSeconds);
}

function MockRow({ tier }: { tier: VanityTier }) {
  const inner = (
    <div className={styles.row}>
      <div className={styles.rowIcon}>🪙</div>
      <div className={styles.rowName}>
        <span className={styles.rowTitle}>{tier.label.toUpperCase()} TOKEN</span>
        <span className={styles.rowSubtitle}>HYPE 3X LONG</span>
      </div>
      <div className={styles.rowMcap}>$12.4K</div>
    </div>
  );
  if (tier.id === "none") return inner;
  return (
    <VanityEffect tier={tier} size="row" as="block">
      {inner}
    </VanityEffect>
  );
}

function MockHero({ tier }: { tier: VanityTier }) {
  const avatar = <div className={styles.heroAvatar}>🪙</div>;
  if (tier.id === "none") return avatar;
  return (
    <VanityEffect tier={tier} size="hero" as="block">
      {avatar}
    </VanityEffect>
  );
}

function MockIcon({ tier }: { tier: VanityTier }) {
  const chip = <div className={styles.iconChip}>🪙</div>;
  if (tier.id === "none") return chip;
  return (
    <VanityEffect tier={tier} size="icon" as="inline">
      {chip}
    </VanityEffect>
  );
}

function MockButton({ tier }: { tier: VanityTier }) {
  const btn = <button className={styles.fakeButton}>⚡ LAUNCH TOKEN</button>;
  if (tier.id === "none") return btn;
  return (
    <VanityEffect tier={tier} size="button" as="block">
      {btn}
    </VanityEffect>
  );
}

export default function VanityTierShowcase() {
  return (
    <div className={styles.layout}>
      <div className={styles.header}>
        <div className={styles.eyebrow}>dev / review</div>
        <h1 className={styles.heading}>Vanity tier showcase</h1>
        <div className={styles.subheading}>
          Every tier rendered at every size used in production. Tier is
          derived purely from the trailing-zero count of the displayed
          address; tiers above `bronze` are progressively rarer (each
          extra zero is ~16x harder to mine). Open the browser console
          on the create page to watch live mining telemetry.
        </div>
      </div>

      <div className={styles.tierGrid}>
        {TIER_TABLE.map((tier) => {
          const bonus
            = tier.minBonus === 0
              ? "0"
              : tier.id === "singularity"
                ? "+11..+35"
                : tier.id === "bronze"
                  ? "+1, +2"
                  : `+${tier.minBonus}`;
          const totalZeros = totalZerosFor(tier);
          const sampleAddress = syntheticAddress(totalZeros);
          const localSec = meanSecondsForZeros(totalZeros, RATE_LOCAL_PER_SEC);
          const gpuSec = meanSecondsForZeros(totalZeros, RATE_GPU_CLUSTER_PER_SEC);
          return (
            <div key={tier.id} className={styles.tierBlock}>
              <div className={styles.tierMeta}>
                <div className={styles.tierName}>{tier.label}</div>
                <div className={styles.tierStats}>
                  <span className={styles.tierStatLabel}>id</span>
                  <span className={styles.tierStatValue}>{tier.id}</span>
                  <span className={styles.tierStatLabel}>bonus zeros</span>
                  <span className={styles.tierStatValue}>{bonus}</span>
                  <span className={styles.tierStatLabel}>total zeros</span>
                  <span className={styles.tierStatValue}>
                    {VANITY_BASE_ZEROS + tier.minBonus}
                    {tier.id === "singularity" ? "+" : ""}
                  </span>
                  <span className={styles.tierStatLabel}>effect</span>
                  <span className={styles.tierStatValue}>{tier.effect}</span>
                  <span className={styles.tierStatLabel}>rarity</span>
                  <span className={styles.tierStatValue}>{tier.rarity}/10</span>
                </div>
              </div>

              <div className={styles.previewArea}>
                <div className={styles.previewLabel}>row (homepage)</div>
                <MockRow tier={tier} />
                <div className={styles.previewRow}>
                  <div className={styles.previewCell}>
                    <span className={styles.cellLabel}>hero avatar</span>
                    <MockHero tier={tier} />
                  </div>
                  <div className={styles.previewCell}>
                    <span className={styles.cellLabel}>icon chip</span>
                    <MockIcon tier={tier} />
                  </div>
                </div>
              </div>

              <div className={styles.previewArea}>
                <div className={styles.previewLabel}>launch button</div>
                <MockButton tier={tier} />
                <div className={styles.address}>{sampleAddress}</div>
              </div>

              <div className={styles.miningEstimates}>
                <div className={styles.estimateBlock}>
                  <span className={styles.estimateLabel}>your machine</span>
                  <span className={styles.estimateValue}>
                    {formatDuration(localSec)}
                  </span>
                  <span className={styles.estimateRate}>
                    ~3M keccak/s · multi-core JS workers
                  </span>
                </div>
                <div className={styles.estimateBlock}>
                  <span className={styles.estimateLabel}>cloud GPU cluster</span>
                  <span className={styles.estimateValue}>
                    {formatDuration(gpuSec)}
                  </span>
                  <span className={styles.estimateRate}>
                    ~10¹¹ keccak/s · ~100 GPU CUDA farm
                  </span>
                </div>
                <div className={styles.estimateBlock}>
                  <span className={styles.estimateLabel}>mean attempts</span>
                  <span className={styles.estimateAttempts}>
                    16^{totalZeros} ≈ {formatAttempts(totalZeros)}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
