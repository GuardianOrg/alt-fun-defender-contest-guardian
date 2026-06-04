import { useQuery } from "@tanstack/react-query";
import { createPublicClient, formatEther, formatUnits, http } from "viem";

import styles from "./ManageWalletTab.module.css";
import profileStyles from "./ProfileView.module.css";
import HypeLogo from "../../assets/Logos/HYPE.svg";
import UsdcLogo from "../../assets/Logos/usdc.svg";
import { hyperEVM } from "../../config/chains";
import {
  RELAY_BRIDGE_HYPE_URL,
  RELAY_BRIDGE_USDC_URL,
  openRelayBridge,
} from "../../config/relay";
import { erc20Abi } from "../../contracts/abis";
import { ADDRESSES, USDC_DECIMALS } from "../../contracts/addresses";
import { useWallet } from "../../hooks/useWallet";
import { cn } from "../../utils/format";
import Button from "../shared/Button";
import Skeleton from "../shared/Skeleton";

const rpcUrl = import.meta.env.VITE_RPC_URL || "https://rpc.hyperliquid.xyz/evm";

// One client per module — same pattern as `TradePanel`. The tab is mounted
// only while the profile page is open and React Query owns the polling
// cadence, so a single read transport is enough. `batch: true` mirrors
// `config/wagmi.ts`; on its own this panel only fires two reads per
// refetch (one `readContract` + one native `getBalance`) and only the
// former rides JSON-RPC batching, but the flag keeps every transport
// configured identically so a future read added here joins the batch
// without extra thought.
const hyperEvmClient = createPublicClient({
  chain: hyperEVM,
  transport: http(rpcUrl, { batch: true }),
});

interface AssetBalances {
  usdcWei: bigint;
  hypeWei: bigint;
}

async function fetchAssetBalances(address: `0x${string}`): Promise<AssetBalances> {
  // Fired in parallel — the two reads are independent and the slowest
  // determines the panel's hydrate latency. `multicall3` would batch them
  // into one round-trip but only for contract calls; native `getBalance`
  // doesn't ride the multicall ABI, so a Promise.all is the cleanest path.
  const [usdcWei, hypeWei] = await Promise.all([
    hyperEvmClient.readContract({
      address: ADDRESSES.usdc,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [address],
    }) as Promise<bigint>,
    hyperEvmClient.getBalance({ address }),
  ]);
  return { usdcWei, hypeWei };
}

/**
 * "Manage Wallet" tab on the profile page. Industry-standard wallet-utility
 * surface: a network indicator at the top so users know which chain the
 * panel reflects, then a list of the two assets the app actually transacts
 * in (USDC for trade in/out, HYPE for gas) with a balance and a one-click
 * link out to relay.link to top each one up.
 *
 * Deliberately scoped to USDC + HYPE — the existing "Balances" tab already
 * lists every Alt Fun token the wallet holds, so duplicating that list here
 * would be noise. This tab answers a different question: "do I have what I
 * need to trade right now?".
 */
export default function ManageWalletTab() {
  const { address, isConnected } = useWallet();

  const balancesQuery = useQuery({
    queryKey: ["wallet-assets", address],
    queryFn: () => fetchAssetBalances(address as `0x${string}`),
    enabled: !!address,
    // Auto-refresh while the panel is open — users alt-tab out to relay,
    // bridge in, and come back; the in-flight tx should reflect within
    // ~one polling cycle without forcing a manual refresh. 15s is short
    // enough to feel live but long enough to keep RPC load trivial.
    refetchInterval: 15_000,
    staleTime: 5_000,
  });

  if (!isConnected || !address) {
    return (
      <div className={profileStyles.emptyState}>
        <div className={profileStyles.emptyTitle}>Wallet not connected</div>
        <div className={profileStyles.emptyBody}>
          Connect your wallet to view balances and top up USDC or gas.
        </div>
      </div>
    );
  }

  const usdcWei = balancesQuery.data?.usdcWei ?? null;
  const hypeWei = balancesQuery.data?.hypeWei ?? null;

  const usdcBalance =
    usdcWei !== null ? parseFloat(formatUnits(usdcWei, USDC_DECIMALS)) : null;
  const hypeBalance =
    hypeWei !== null ? parseFloat(formatEther(hypeWei)) : null;

  return (
    <div>
      <NetworkStrip />

      <div className={cn(styles.sectionHeader, "ui-subheading")}>
        Assets needed for trading
      </div>

      <div className={styles.assetList}>
        <AssetRow
          logoSrc={UsdcLogo}
          ticker="USDC"
          name="USD Coin"
          contractAddress={ADDRESSES.usdc}
          tag="Trade currency"
          balance={usdcBalance}
          formatBalance={formatUsdcBalance}
          balanceSuffix="USDC"
          actionLabel="Get USDC"
          ariaLabel="Bridge USDC to HyperEVM via Relay"
          onAction={() => openRelayBridge(RELAY_BRIDGE_USDC_URL)}
          isLoading={balancesQuery.isLoading}
        />
        <AssetRow
          logoSrc={HypeLogo}
          ticker="HYPE"
          name="Hyperliquid"
          contractAddress="native"
          tag="Gas token"
          balance={hypeBalance}
          formatBalance={formatHypeBalance}
          balanceSuffix="HYPE"
          actionLabel="Get gas"
          ariaLabel="Bridge HYPE to HyperEVM via Relay"
          onAction={() => openRelayBridge(RELAY_BRIDGE_HYPE_URL)}
          isLoading={balancesQuery.isLoading}
        />
      </div>

      <div className={styles.footerHint}>
        Bridge from Ethereum, Arbitrum, Base, Solana and 20+ other chains
        via{" "}
        <a
          className={styles.footerHintLink}
          href="https://relay.link/bridge/hyperevm"
          target="_blank"
          rel="noopener noreferrer"
        >
          Relay
        </a>
        . Funds arrive directly in your connected wallet on HyperEVM.
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sub-components                                                     */
/* ------------------------------------------------------------------ */

/**
 * Network indicator strip. Mirrors the wallet-style "you are on chain X"
 * banner every multi-chain dApp surfaces so users can't mistake the
 * balances below for an L1 or another rollup.
 */
function NetworkStrip() {
  return (
    <div className={styles.networkStrip}>
      <div className={styles.networkLeft}>
        <div className={styles.networkMeta}>
          <span className={cn(styles.networkLabel, "ui-subheading")}>
            Network
          </span>
          <span className={styles.networkName}>HyperEVM</span>
        </div>
      </div>
      <div className={styles.networkRight}>
        <span className={cn(styles.networkLabel, "ui-subheading")}>
          Chain ID
        </span>
        <span className={styles.networkChainId}>{hyperEVM.id}</span>
      </div>
    </div>
  );
}

interface AssetRowProps {
  logoSrc: string;
  ticker: string;
  name: string;
  /** Contract address for ERC-20s, or the literal `"native"` for the
   *  chain's gas token. Drives the tiny "ERC-20 / Native" pill. */
  contractAddress: `0x${string}` | "native";
  /** Optional tag (e.g. "Gas token") rendered next to the asset name. */
  tag?: string;
  balance: number | null;
  formatBalance: (value: number) => string;
  balanceSuffix: string;
  actionLabel: string;
  ariaLabel: string;
  onAction: () => void;
  isLoading: boolean;
}

function AssetRow({
  logoSrc,
  ticker,
  name,
  contractAddress,
  tag,
  balance,
  formatBalance,
  balanceSuffix,
  actionLabel,
  ariaLabel,
  onAction,
  isLoading,
}: AssetRowProps) {
  return (
    <div className={styles.assetRow}>
      <img
        src={logoSrc}
        alt=""
        className={styles.assetIcon}
        width={40}
        height={40}
      />

      <div className={styles.assetMeta}>
        <div className={styles.assetTickerRow}>
          <span className={styles.assetTicker}>{ticker}</span>
          {tag && <span className={styles.assetTag}>{tag}</span>}
          <span className={styles.assetTypePill}>
            {contractAddress === "native" ? "NATIVE" : "ERC-20"}
          </span>
        </div>
        <span className={styles.assetName}>{name}</span>
      </div>

      <div className={styles.assetBalance}>
        {isLoading || balance === null ? (
          <Skeleton width="6rem" height="1.4rem" />
        ) : (
          <span className={styles.assetBalanceAmount}>
            {formatBalance(balance)}
            <span className={styles.assetBalanceSuffix}>
              {" "}{balanceSuffix}
            </span>
          </span>
        )}
      </div>

      <div className={styles.assetAction}>
        <Button
          variant="secondary"
          size="sm"
          onClick={onAction}
          aria-label={ariaLabel}
        >
          {actionLabel}
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Per-asset balance formatters                                       */
/* ------------------------------------------------------------------ */

/** USDC balances format like fiat: 2dp, comma separators, never scientific. */
function formatUsdcBalance(value: number): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * HYPE balances format with magnitude-aware precision:
 *   - ≥ 1 HYPE      → 4dp (e.g. `12.3456`)
 *   - 0.0001–1 HYPE → 6dp so sub-1-HYPE balances stay readable
 *   - 0–0.0001 HYPE → "<0.0001" sentinel rather than collapsing to "0.0000"
 *
 * Mirrors the precision the gas-low CTA threshold (0.005 HYPE) operates at,
 * so a user reading the balance can compare it against the threshold
 * without doing mental scientific notation.
 */
function formatHypeBalance(value: number): string {
  if (value === 0) return "0";
  if (value < 0.0001) return "<0.0001";
  if (value < 1) {
    return value.toLocaleString(undefined, {
      minimumFractionDigits: 6,
      maximumFractionDigits: 6,
    });
  }
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
}
