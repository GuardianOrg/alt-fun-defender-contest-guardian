import { useQuery } from "@tanstack/react-query";
import { createPublicClient, formatUnits, http } from "viem";

import { useMarketData } from "./useMarketData";
import { useTokenPrices } from "./useTokenPrices";
import { useWallet } from "./useWallet";
import { hyperEVM } from "../config/chains";
import { DEFAULT_TOKEN_IMAGE } from "../config/constants";
import { erc20Abi } from "../contracts/abis";
import { API_BASE, fetchAllTokens, fetchBalances } from "../services/api";

import type { HeldToken } from "../services/types";

/**
 * The API stores token logo paths as root-relative (e.g.
 * `/images/tokens/<key>`) so the same DB row renders against any
 * frontend's `API_BASE`. Token-list rows flow through
 * `fromApiToken` which resolves these against `API_BASE`; the
 * balances hook bypasses that path (it builds `HeldToken` directly
 * from the chain multicall + balances API), so we have to do the
 * same resolution here or every "My Positions" logo loads from the
 * webapp's own origin and 404s. Tokens whose creator skipped image
 * upload fall through to the public `DEFAULT_TOKEN_IMAGE` so the
 * row matches what the home-page list renders for the same token —
 * see the constant's docstring in `config/constants.ts`.
 */
function resolveImageUrl(raw: string | undefined): string {
  if (!raw) return DEFAULT_TOKEN_IMAGE;
  return new URL(raw, API_BASE).toString();
}

const rpcUrl = import.meta.env.VITE_RPC_URL || "https://rpc.hyperliquid.xyz/evm";
const hyperEvmClient = createPublicClient({
  chain: hyperEVM,
  transport: http(rpcUrl),
});

export interface RawBalance {
  address: string;
  name: string;
  ticker: string;
  ltPair: string;
  leverage: number;
  balance: bigint;
  /** Token logo URL (R2-served). Empty string when the creator never uploaded one. */
  imageUrl: string;
  /**
   * `true` when the token is currently admin-hidden from the public
   * listings. Holders still see the position in their "My Positions"
   * panel (issue #712) so they can sell it; the row is marked so the
   * UI can render the policy-violation hint and disable buys.
   */
  isHidden: boolean;
}

/**
 * Minimum USD value a position must clear to render in the "My
 * Positions" panel. Anything below this is dust — typically a
 * leftover sliver from a token the user has effectively fully sold.
 * The threshold runs unconditionally (i.e. it is NOT gated on a
 * "prices loaded" flag): when prices haven't arrived yet,
 * `getPrice` returns `0`, every `valueUsd` collapses to `0`, and
 * the filter cleanly excludes every row. Leaking unpriced rows
 * through during the prices-loading window caused the bug where
 * dust positions flashed as `$0` + `—` before disappearing into
 * "No positions yet" once the prices payload landed. The consumer's
 * skeleton path already keys off the hook's combined `isLoading`
 * (which folds in `pricesLoading`), so the loading state is
 * covered without us needing to surface ghost rows.
 */
export const MIN_DISPLAY_VALUE_USD = 0.1;

/**
 * Pure builder for the `HeldToken[]` list rendered by the balances UI.
 * Extracted from {@link useBalances} so the dust-filter contract is
 * exercisable in unit tests without standing up React Query / viem /
 * Privy. Kept named (rather than inlined) so the regression test for
 * the `$0 ghosts → No positions yet` flash (the prices-loading bug)
 * stays close to the production code path.
 */
export function buildHeldTokens(
  rawBalances: readonly RawBalance[],
  getPrice: (address: string) => number,
  getTokenMarketData: (
    address: string,
  ) => { change24h?: number | null } | undefined,
): HeldToken[] {
  return rawBalances
    .map((b) => {
      const amount = parseFloat(formatUnits(b.balance, 18));
      const pricePerToken = getPrice(b.address);
      const marketEntry = getTokenMarketData(b.address);
      return {
        address: b.address,
        name: b.name,
        ticker: b.ticker,
        emoji: "",
        image: resolveImageUrl(b.imageUrl),
        ltName: `${b.ltPair} ${b.leverage}×`,
        status: "active" as const,
        amount,
        valueUsd: amount * pricePerToken,
        change24h: marketEntry?.change24h ?? null,
        isHidden: b.isHidden,
      };
    })
    .filter((t) => t.valueUsd >= MIN_DISPLAY_VALUE_USD);
}

/**
 * Indexer-backed balances path. Reads Ponder's `tokenBalances` index
 * (wallet-scoped) and normalises the rows into the shared {@link
 * RawBalance} shape. Currently used both as the fallback when the
 * chain multicall throws AND as the source of truth for hidden-token
 * positions (see {@link mergeHiddenFromApi}) — the chain path can't
 * surface hidden tokens because they're filtered out of the public
 * catalogue.
 */
async function fetchRawBalancesFromApi(
  walletAddress: string,
): Promise<RawBalance[]> {
  const rawBalances = await fetchBalances(walletAddress);
  return rawBalances.map((b) => ({
    address: b.address,
    name: b.name,
    ticker: b.ticker,
    ltPair: b.ltPair,
    leverage: b.leverage,
    balance: BigInt(b.balance),
    imageUrl: b.imageUrl,
    isHidden: b.isHidden,
  }));
}

/**
 * Primary balances path: walk every public-catalogue token and probe
 * the wallet's `balanceOf` via a chunked viem multicall. Authoritative
 * because the chain is the source of truth and works regardless of
 * indexer health. See the inline comment for the chunk-size rationale
 * — HyperEVM small blocks cap multicalls at ~2M gas, so we batch in
 * 250-token chunks to stay well under the ceiling on a fully-grown
 * catalogue.
 */
async function fetchRawBalancesFromChain(
  walletAddress: string,
): Promise<RawBalance[]> {
  // Walk the full catalogue, not just the first page. The chain path is
  // primary (the indexer's `tokenBalance` index is empty until #418 ships)
  // and a hard-coded `fetchTokens(100)` cap means holders of any token
  // outside the first 100 silently see `0` for it on the balances panel
  // (issue #476). `fetchAllTokens` paginates server-side at 100/page; if
  // any page fails, the throw bubbles up to the queryFn's `catch` and
  // we fall through to the API fallback below.
  const tokens = await fetchAllTokens();
  // Empty catalogue almost certainly means the API is down (we always have
  // ≥1 token in production). Throw so `useBalances` falls through to the
  // indexer-backed API fallback rather than silently rendering "No
  // positions yet".
  if (tokens.length === 0) {
    throw new Error("Token catalogue unavailable");
  }

  // Chunk the multicall so a fully-grown catalogue doesn't blow past the
  // RPC's per-call gas / payload ceiling. viem's multicall packs every
  // call into a single `Multicall3.aggregate3` invocation; HyperEVM small
  // blocks have a ~2M gas cap, so a few thousand `balanceOf` calls in one
  // tx will revert with `out of gas`. 250 keeps us well under the
  // ceiling while still amortising the round-trip cost (~10 RPC calls
  // per 2.5K tokens). Build the call objects per-chunk (rather than
  // pre-allocating an N-length array of throwaway descriptors) so the
  // peak memory footprint scales with chunk size, not catalogue size.
  const MULTICALL_CHUNK_SIZE = 250;
  const balances: RawBalance[] = [];
  for (let start = 0; start < tokens.length; start += MULTICALL_CHUNK_SIZE) {
    const tokenChunk = tokens.slice(start, start + MULTICALL_CHUNK_SIZE);
    const chunkResults = await hyperEvmClient.multicall({
      contracts: tokenChunk.map((token) => ({
        address: token.address as `0x${string}`,
        abi: erc20Abi,
        functionName: "balanceOf" as const,
        args: [walletAddress as `0x${string}`],
      })),
      allowFailure: true,
    });
    for (let i = 0; i < chunkResults.length; i++) {
      const result = chunkResults[i];
      if (result.status !== "success") continue;
      const balance = result.result as bigint;
      if (balance <= 0n) continue;
      const token = tokenChunk[i];
      balances.push({
        address: token.address,
        name: token.name,
        ticker: token.ticker,
        ltPair: token.ltPair,
        leverage: token.leverage,
        balance,
        imageUrl: token.imageUrl,
        // `fetchAllTokens` is filtered to the public lens, so every entry
        // we just multicalled is non-hidden by construction. Hidden
        // positions are merged in separately from the API balances call
        // below — see `useBalances.queryFn`.
        isHidden: false,
      });
    }
  }
  return balances;
}

/**
 * Fold any hidden-token positions the API surfaces into the chain-derived
 * balance set (issue #712). The chain multicall walks `fetchAllTokens`,
 * which is filtered to the public lens — so a hidden token a wallet
 * still holds never gets a `balanceOf` probe. The API balances endpoint
 * is wallet-scoped (via Ponder's `tokenBalances`) and now exposes hidden
 * rows, so any position the chain path missed shows up here marked
 * `isHidden: true`.
 *
 * If the API call fails (or Ponder's index is cold), hidden positions
 * silently fall off the panel rather than corrupting the chain-derived
 * visible positions. Trust order: chain wins on overlap, API only fills
 * the hidden-token gap.
 */
async function mergeHiddenFromApi(args: {
  walletAddress: string;
  chainBalances: RawBalance[];
}): Promise<RawBalance[]> {
  let apiBalances: RawBalance[];
  try {
    apiBalances = await fetchRawBalancesFromApi(args.walletAddress);
  } catch {
    return args.chainBalances;
  }
  if (apiBalances.length === 0) return args.chainBalances;
  const knownAddresses = new Set(
    args.chainBalances.map((b) => b.address.toLowerCase()),
  );
  const hiddenExtras = apiBalances.filter(
    (b) => b.isHidden && !knownAddresses.has(b.address.toLowerCase()),
  );
  if (hiddenExtras.length === 0) return args.chainBalances;
  return [...args.chainBalances, ...hiddenExtras];
}

/**
 * React Query-backed hook powering the "MY POSITIONS" panel and the
 * Earnings / Profile balances tabs. Joins three upstream sources:
 *
 *   1. The on-chain `balanceOf` multicall (primary; authoritative
 *      regardless of indexer health).
 *   2. The wallet-scoped `/balances` API call (fills in hidden
 *      positions the chain path can't surface — see {@link
 *      mergeHiddenFromApi}).
 *   3. The token-price + market-data caches via {@link useTokenPrices}
 *      / {@link useMarketData}.
 *
 * Returns a `HeldToken[]` already filtered through the dust threshold
 * (see {@link buildHeldTokens}) plus a `totalValue` rollup and a
 * combined `isLoading` flag that folds both queries so consumers can
 * drive a single skeleton state.
 */
export function useBalances() {
  const { address } = useWallet();
  const { getPrice, isLoading: pricesLoading } = useTokenPrices();
  const { getTokenMarketData } = useMarketData();

  const query = useQuery({
    queryKey: ["balances", address],
    queryFn: async (): Promise<RawBalance[]> => {
      if (!address) throw new Error("Address required");
      // On-chain multicall is authoritative and works regardless of indexer
      // health. The API path (`fetchRawBalancesFromApi`) reads the indexer's
      // `tokenBalance` index, which is currently empty for every token (see
      // bounce-tech/alt-fun#418 — `Token:Transfer` events are not being
      // ingested), so it silently returns no positions and the "MY POSITIONS"
      // panel always shows "No positions yet". Until #418 ships, chain is
      // the source of truth here; the API call is kept as a fallback for
      // RPC outages. Token catalogue is ~100 entries today, so the multicall
      // fits in a single RPC round-trip.
      //
      // Hidden tokens are NOT in `fetchAllTokens` (the public catalogue is
      // filtered to `isHidden = false`), so the chain path can never surface
      // a hidden position. The API path, however, is wallet-scoped via
      // Ponder and now returns hidden rows for holders (issue #712); we
      // fold those in on top of the chain result so a holder can still see
      // (and sell) their hidden position. If the API path fails entirely
      // we fall back to it as the only source, mirroring the previous
      // behaviour for RPC outages.
      try {
        const chainBalances = await fetchRawBalancesFromChain(address);
        return await mergeHiddenFromApi({
          walletAddress: address,
          chainBalances,
        });
      } catch {
        return fetchRawBalancesFromApi(address);
      }
    },
    enabled: !!address,
  });

  const tokens = buildHeldTokens(query.data ?? [], getPrice, getTokenMarketData);

  const totalValue = tokens.reduce((sum, t) => sum + t.valueUsd, 0);

  return {
    tokens,
    totalValue,
    isLoading: query.isLoading || pricesLoading,
  };
}
