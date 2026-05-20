import { HYPER_EVM } from "@launchpad/shared";
import { and, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { createPublicClient, erc20Abi, getAddress, http, isAddress } from "viem";
import { z } from "zod";

import { createDb } from "../../db/client.js";
import { tokens } from "../../db/schema.js";
import {
  computeMarketDataSingle,
  type MarketDataItem,
  type PonderTokenOnchain,
} from "../../lib/market-data.js";
import { getGraduationThresholdUsd } from "../../lib/protocol-config.js";
import {
  computeCurveFilled,
  computeCurveFilledBreakdown,
  computeStatus,
  usdcRawToUsd,
  type DbToken,
  type EnrichedToken,
} from "../../lib/token-enrich.js";
import { edgeCacheableJsonHeader } from "../../utils/cache-control.js";
import formatError from "../../utils/format-error.js";
import formatSuccess from "../../utils/format-success.js";
import { zodValidator } from "../../utils/validation.js";

import type { AppBindings } from "../../lib/types.js";

const DETAIL_CACHE_TTL_SECONDS = 2;
// Short TTL for responses served while Ponder/BounceTech are down. Absorbs
// bursts so an outage doesn't amplify into load on the already-struggling
// dependency, while still recovering within ~1s once it comes back.
const DEGRADED_CACHE_TTL_SECONDS = 1;

const batchTokensSchema = z.object({
  addresses: z
    .array(z.string())
    .min(1, "At least one address is required")
    .max(100, "Maximum 100 addresses per batch"),
});

function enrich(
  dbToken: DbToken,
  onchain: PonderTokenOnchain | null | undefined,
  market: MarketDataItem | null | undefined,
  graduationThresholdUsd: number,
): EnrichedToken {
  const { graduatedAt: dbGraduatedAt, createdAt, ...rest } = dbToken;
  const curveSupply = onchain?.curveSupply ?? null;
  const ltReserve = onchain?.ltReserve ?? null;
  const graduated = onchain?.graduated ?? false;
  const pendingGraduation = onchain?.pendingGraduation ?? false;
  const breakdown = computeCurveFilledBreakdown(
    curveSupply,
    ltReserve,
    onchain?.k ?? null,
    onchain?.organicUsdcRaised ?? null,
    market?.ltExchangeRate ?? null,
    graduated,
    graduationThresholdUsd,
  );
  const curveFilled = breakdown.total ?? computeCurveFilled(curveSupply);
  const status = computeStatus(graduated, pendingGraduation);
  const hyperswapPair = onchain?.hyperswapPair ?? dbToken.poolAddress ?? null;
  const lastTradeAt =
    market?.lastTradeAtSec != null
      ? new Date(market.lastTradeAtSec * 1000).toISOString()
      : null;

  return {
    ...rest,
    createdAt: createdAt.toISOString(),
    poolAddress: hyperswapPair,
    curveSupply,
    ltReserve,
    curveFilled,
    curveFilledOrganic: breakdown.organic,
    curveFilledLeverageBoost: breakdown.leverageBoost,
    curveRaisedUsd: breakdown.raisedUsd,
    status,
    graduated,
    graduatedAt: onchain?.graduatedAt
      ? new Date(Number(onchain.graduatedAt) * 1000).toISOString()
      : dbGraduatedAt
        ? dbGraduatedAt.toISOString()
        : null,
    pendingGraduation,
    pendingGraduationAt: onchain?.pendingGraduationAt
      ? new Date(Number(onchain.pendingGraduationAt) * 1000).toISOString()
      : null,
    bondingPair: onchain?.bondingPair ?? null,
    hyperswapPair,
    priceUsd: market?.priceUsd ?? null,
    mcapUsd: market?.mcapUsd ?? null,
    change24h: market?.change24h ?? null,
    ltChange24h: market?.ltChange24h ?? null,
    volume24hUsd: market?.volume24hUsd ?? null,
    // `onchain == null` ⇒ indexer unreachable for this token: return `null`
    // so clients can disambiguate from a legitimately-zero counter. When the
    // row exists but the indexer is an older build missing the `volumeUsd`
    // column, `usdcRawToUsd` returns null and we fall through to `0` — which
    // matches the documented "row exists ⇒ 0, not null" semantics.
    totalVolumeUsd:
      onchain == null ? null : (usdcRawToUsd(onchain.volumeUsd) ?? 0),
    // Same null-vs-zero semantics as `totalVolumeUsd` — see comment above.
    creatorFeesUsd:
      onchain == null ? null : (usdcRawToUsd(onchain.creatorFeesUsd) ?? 0),
    protocolFeesUsd:
      onchain == null ? null : (usdcRawToUsd(onchain.protocolFeesUsd) ?? 0),
    lastTradeAt,
  };
}

const detailRoute = new Hono<{ Bindings: AppBindings }>();

detailRoute.post("/batch", zodValidator("json", batchTokensSchema), async (c) => {
  const { addresses } = c.req.valid("json");

  const db = createDb(c.env.HYPERDRIVE.connectionString);
  const results = await db
    .select()
    .from(tokens)
    .where(and(eq(tokens.isHidden, false), inArray(tokens.address, addresses)));

  return c.json(formatSuccess(results));
});

/**
 * Server-side `balanceOf(wallet)` probe used by the holder-aware detail
 * bypass. Hidden tokens are 404 for the public lens; once a wallet has
 * proven (via a single on-chain read) that it holds the token, we serve
 * the row so that wallet can sell the position (issue #712).
 *
 * Returns `true` only on a confirmed non-zero balance — RPC errors and a
 * zero balance both fall through to the 404 path, never to a leak.
 */
async function walletHoldsToken(args: {
  env: AppBindings;
  tokenAddress: `0x${string}`;
  wallet: `0x${string}`;
}): Promise<boolean> {
  try {
    const transport = http(args.env.HYPEREVM_RPC_URL || HYPER_EVM.rpcUrl);
    const client = createPublicClient({
      chain: {
        id: HYPER_EVM.id,
        name: HYPER_EVM.name,
        nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
        rpcUrls: { default: { http: [HYPER_EVM.rpcUrl] } },
      } as const,
      transport,
    });
    const balance = (await client.readContract({
      address: args.tokenAddress,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [args.wallet],
    })) as bigint;
    return balance > 0n;
  } catch {
    return false;
  }
}

detailRoute.get("/:address", async (c) => {
  const rawAddress = c.req.param("address");
  if (!isAddress(rawAddress)) {
    return c.json(formatError("Invalid address"), 400);
  }
  const address = getAddress(rawAddress);

  // Optional `?wallet=0x…` query param. When supplied AND the wallet
  // currently holds a non-zero balance of the (otherwise-hidden) token,
  // we serve the row so the holder can sell their position. Absent /
  // invalid / zero-balance callers continue to see a public-lens 404,
  // exactly as before — see issue #712 / #586.
  const rawWallet = c.req.query("wallet");
  const wallet =
    rawWallet && isAddress(rawWallet) ? getAddress(rawWallet) : null;

  const cachesObj = (globalThis as { caches?: { default?: Cache } }).caches;
  const cache = cachesObj?.default;
  // Cache key strips `?wallet=` so a wallet-bearing request for a
  // *public* token shares a slot with the anonymous version — the
  // response shape is wallet-agnostic for the public lens (the wallet
  // param only ever influences the hidden-token holder bypass below).
  // Pre-#930 we skipped the cache entirely whenever any wallet was
  // present, which sent every signed-in user to origin on a route that
  // was already running at p99 ≈ 10s. Hidden-token holder responses
  // are still uncached — see the `isHiddenBypass` branch at the end of
  // this handler — so the bypass invariant from issues #712 / #586
  // (hidden bodies never enter `caches.default`, never get a positive
  // `s-maxage`) holds.
  const cacheUrl = new URL(c.req.url);
  cacheUrl.searchParams.delete("wallet");
  const cacheKey = new Request(cacheUrl.toString(), { method: "GET" });
  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  }

  const db = createDb(c.env.HYPERDRIVE.connectionString);
  // Two-step lookup. We always start with the public lens
  // (`isHidden = false`); only when that misses AND a wallet is present
  // do we fall back to a wallet-gated lookup of the hidden row + a
  // server-side `balanceOf` proof. This preserves the issue #586
  // contract (hidden tokens look like 404 to everyone with no proof of
  // ownership) while unblocking the issue #712 holder-only sell path.
  let [dbToken] = await db
    .select()
    .from(tokens)
    .where(and(eq(tokens.address, address), eq(tokens.isHidden, false)))
    .limit(1);

  // `isHiddenBypass` is the only signal that flips this response into
  // the per-wallet, must-not-be-cached branch — it's deliberately scoped
  // to *successful* hidden-token holder bypasses (hidden row exists AND
  // the supplied wallet's `balanceOf` is non-zero). A wallet-bearing
  // request that resolves through the public lens, or that ends in a
  // 404, follows the cacheable path identically to an anonymous one.
  let isHiddenBypass = false;
  if (!dbToken && wallet) {
    const [hiddenRow] = await db
      .select()
      .from(tokens)
      .where(and(eq(tokens.address, address), eq(tokens.isHidden, true)))
      .limit(1);
    if (hiddenRow) {
      const holds = await walletHoldsToken({
        env: c.env,
        tokenAddress: address as `0x${string}`,
        wallet: wallet as `0x${string}`,
      });
      if (holds) {
        dbToken = hiddenRow;
        isHiddenBypass = true;
      }
    }
  }

  if (!dbToken) {
    return c.json(formatError("Token not found"), 404);
  }

  const marketResult = await computeMarketDataSingle(
    c.env.HYPERDRIVE.connectionString,
    c.env.BOUNCETECH_DATABASE_URL,
    address,
  );

  const dataSource = marketResult.ok ? "live" : "degraded";
  const onchain = marketResult.ok ? marketResult.data.token : null;
  const market = marketResult.ok ? marketResult.data.market : null;

  const graduationThresholdUsd = await getGraduationThresholdUsd(c.env);
  const response = c.json(
    formatSuccess(
      enrich(dbToken, onchain, market, graduationThresholdUsd),
      dataSource,
    ),
  );

  // Hidden-token holder bypass responses MUST NOT be cached anywhere:
  // they're per-wallet by definition and any intermediary that re-served
  // one to a different caller would leak a hidden token to a non-holder.
  // We skip `cache.put` *and* set `private, no-store, max-age=0,
  // s-maxage=0` so neither Cloudflare's edge cache (which honours
  // `s-maxage`) nor any shared HTTP cache between origin and client
  // retains the body.
  //
  // Every other response path — public-lens hits whether or not a
  // wallet was supplied — uses `edgeCacheableJsonHeader` (`public,
  // max-age=0, s-maxage=ttl, stale-while-revalidate=2*ttl`). The
  // `max-age=0` keeps the browser revalidating on every reload (the
  // bare `s-maxage` form left the browser free to apply heuristic
  // caching on `Cache-Control` directives meant for shared caches
  // only, which used to freeze the home-page list until users cleared
  // browsing data); the `s-maxage` lets a hot token absorb bursts at
  // the edge.
  if (isHiddenBypass) {
    response.headers.set(
      "Cache-Control",
      "private, no-store, max-age=0, s-maxage=0",
    );
  } else {
    const ttl = marketResult.ok ? DETAIL_CACHE_TTL_SECONDS : DEGRADED_CACHE_TTL_SECONDS;
    response.headers.set("Cache-Control", edgeCacheableJsonHeader(ttl));
    if (cache) {
      await cache.put(cacheKey, response.clone());
    }
  }

  return response;
});

export default detailRoute;
