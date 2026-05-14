import { useMemo } from "react";

import { useQuery } from "@tanstack/react-query";
import { createPublicClient, formatUnits, http } from "viem";

import { useMarketData } from "./useMarketData";
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
 * chain multicall throws AND as the gap-fill for any positions the
 * chain didn't resolve (see {@link mergeApiPositions}) — covers hidden
 * tokens (filtered out of the public catalogue, issue #712) plus any
 * `balanceOf` calls that returned `failure` instead of an
 * authoritative `0` (issue #881).
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
 * Outcome of the on-chain multicall sweep. The `balances` array carries
 * the raw rows we'll render. `resolvedAddresses` is the set of token
 * addresses (lowercased) where the multicall produced an authoritative
 * answer — covers BOTH "balance > 0" rows in `balances` AND tokens whose
 * `balanceOf` succeeded with `0` (i.e. the user has fully sold). Used
 * downstream by {@link mergeApiBalances} to distinguish "chain says no
 * (don't add stale indexer rows back)" from "chain didn't answer at all
 * (gap-fill from the API)".
 */
export interface ChainBalanceResult {
  balances: RawBalance[];
  resolvedAddresses: ReadonlySet<string>;
}

/**
 * Pure builder that folds API-sourced balances into the chain-derived
 * set, preserving the chain's authority on overlap. Extracted from the
 * async {@link mergeApiPositions} so the gap-fill semantics for issue
 * #881 (chain `balanceOf` returns `failure`, indexer has the row) and
 * issue #712 (hidden token isn't in the catalogue, never multicalled)
 * are exercisable in unit tests without standing up the API client.
 *
 * Trust order:
 *   - `chain.balances` always passes through unchanged. Chain wins on
 *     overlap by construction — anything the chain successfully resolved
 *     (positive OR `0`) lives in `chain.resolvedAddresses` and is
 *     skipped from the API merge below.
 *   - `apiBalances` rows for addresses not in `chain.resolvedAddresses`
 *     get appended. This is the gap fill: the chain either failed to
 *     query the address (multicall `failure`) or never tried (token
 *     not in the catalogue), and the indexer's wallet-scoped view is
 *     the only authoritative answer we have.
 *
 * Safe to call with an empty API set — the helper short-circuits to
 * the chain rows in that case so the queryFn never allocates a fresh
 * array for a no-op merge.
 */
export function mergeApiBalances(
  chain: ChainBalanceResult,
  apiBalances: readonly RawBalance[],
): RawBalance[] {
  if (apiBalances.length === 0) return chain.balances;
  const apiExtras = apiBalances.filter(
    (b) => !chain.resolvedAddresses.has(b.address.toLowerCase()),
  );
  if (apiExtras.length === 0) return chain.balances;
  return [...chain.balances, ...apiExtras];
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
): Promise<ChainBalanceResult> {
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
  const resolvedAddresses = new Set<string>();
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
      const token = tokenChunk[i];
      // `allowFailure: true` swallows individual reverts as
      // `status: "failure"`. A failed call means we have no
      // authoritative answer for that token, NOT that the user holds
      // zero of it — record nothing, and let `mergeApiPositions` fill
      // the gap from the indexer if it has a row for it (issue #881).
      if (result.status !== "success") continue;
      // Successful answer (whether positive or zero) means the chain
      // is authoritative for this token at this block. Mark it
      // resolved so the API merge below doesn't re-introduce a stale
      // indexer row (e.g. user fully sold and the indexer hasn't
      // ingested the sale yet).
      resolvedAddresses.add(token.address.toLowerCase());
      const balance = result.result as bigint;
      if (balance <= 0n) continue;
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
  return { balances, resolvedAddresses };
}

/**
 * Fold any positions the API surfaces but the chain multicall didn't into
 * the final balance set. Originally narrow to hidden tokens (issue #712 —
 * those are filtered out of `fetchAllTokens` by construction so the chain
 * path could never see them), but the same gap-filling logic is needed
 * for any non-hidden token the multicall left unresolved (issue #881):
 *
 *   - Individual `balanceOf` calls inside a `multicall({ allowFailure:
 *     true })` can return `status: "failure"` (revert / RPC node hadn't
 *     propagated a freshly-deployed contract / chunk-level transient
 *     error) and are skipped via `continue` in
 *     `fetchRawBalancesFromChain`. Without an API merge those positions
 *     vanish.
 *   - The catalogue used to drive the multicall is itself eventually-
 *     consistent (see `Cache-Control: s-maxage=5` on `/api/v1/tokens`).
 *     A token freshly registered seconds ago may not be in the cached
 *     page the user's session pulls, so the chain probe never runs for
 *     it even though the indexer's wallet-scoped index already has the
 *     balance.
 *
 * Trust order is unchanged: chain still wins on overlap. The merge
 * skips API rows for any address the chain *resolved* — even when that
 * resolution was a successful `balanceOf == 0` — so a briefly-stale
 * indexer (user fully sold, the `Transfer` event hasn't been ingested
 * yet) does NOT smuggle a sold-out position back into the panel. Only
 * tokens whose chain answer was `failure` (no authoritative answer) or
 * that were never queried at all (not in the catalogue) get filled in
 * from the API.
 *
 * If the API call fails (or Ponder's index is cold), the gap-fill is
 * skipped silently and we render the chain-derived set as-is.
 */
async function mergeApiPositions(args: {
  walletAddress: string;
  chain: ChainBalanceResult;
}): Promise<RawBalance[]> {
  let apiBalances: RawBalance[];
  try {
    apiBalances = await fetchRawBalancesFromApi(args.walletAddress);
  } catch {
    return args.chain.balances;
  }
  return mergeApiBalances(args.chain, apiBalances);
}

/**
 * React Query-backed hook powering the "MY POSITIONS" panel and the
 * Earnings / Profile balances tabs. Joins three upstream sources:
 *
 *   1. The on-chain `balanceOf` multicall (primary; authoritative
 *      regardless of indexer health).
 *   2. The wallet-scoped `/balances` API call (fills in any positions
 *      the chain path can't surface — hidden tokens (issue #712), plus
 *      anything else the multicall silently missed; see {@link
 *      mergeApiPositions}).
 *   3. The market-data cache via {@link useMarketData} (one query
 *      drives both the per-token `priceUsd` lookup the dust filter
 *      reads through `getPrice` and the `change24h` row column).
 *
 * Returns a `HeldToken[]` already filtered through the dust threshold
 * (see {@link buildHeldTokens}) plus a `totalValue` rollup and a
 * combined `isLoading` flag that folds both queries so consumers can
 * drive a single skeleton state.
 */
export function useBalances() {
  const { address } = useWallet();

  const query = useQuery({
    queryKey: ["balances", address],
    queryFn: async (): Promise<RawBalance[]> => {
      if (!address) throw new Error("Address required");
      // On-chain multicall is authoritative and works regardless of indexer
      // health. The API path (`fetchRawBalancesFromApi`) reads the indexer's
      // `tokenBalance` index, which is currently empty for every token (see
      // #418 — `Token:Transfer` events are not being
      // ingested), so it silently returns no positions and the "MY POSITIONS"
      // panel always shows "No positions yet". Until #418 ships, chain is
      // the source of truth here; the API call is kept as a fallback for
      // RPC outages. Token catalogue is ~100 entries today, so the multicall
      // fits in a single RPC round-trip.
      //
      // The chain multicall can also silently miss individual tokens —
      // hidden tokens are filtered out of `fetchAllTokens` by construction
      // (issue #712), and a freshly-launched contract can land an
      // `allowFailure: true` `balanceOf` revert / pre-cache miss on the
      // catalogue page (issue #881). The API path is wallet-scoped via
      // Ponder, doesn't touch the catalogue, and lists every token whose
      // indexed balance is `> 0`, so we fold its rows on top of the chain
      // result for any addresses the multicall didn't surface. Chain
      // still wins on overlap, so a successful `balanceOf == 0` (user
      // fully sold) removes the token from `chainBalances` AND from
      // `mergeApiPositions`'s gap fill — see the function's docstring.
      // If the API path fails entirely we fall back to it as the only
      // source, mirroring the previous behaviour for RPC outages.
      try {
        const chain = await fetchRawBalancesFromChain(address);
        return await mergeApiPositions({
          walletAddress: address,
          chain,
        });
      } catch {
        return fetchRawBalancesFromApi(address);
      }
    },
    enabled: !!address,
  });

  // Held addresses drive the per-page market-data + price fetches —
  // never the whole catalogue. Re-derives on every balances refetch so
  // a newly-acquired position lights up its USD value within the next
  // market-data poll cycle.
  const heldAddresses = useMemo(
    () => (query.data ?? []).map((b) => b.address),
    [query.data],
  );
  const {
    getPrice,
    getTokenMarketData,
    isLoading: marketLoading,
  } = useMarketData(heldAddresses);

  const tokens = buildHeldTokens(query.data ?? [], getPrice, getTokenMarketData);

  const totalValue = tokens.reduce((sum, t) => sum + t.valueUsd, 0);

  return {
    tokens,
    totalValue,
    isLoading: query.isLoading || marketLoading,
  };
}
