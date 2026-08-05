import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { getAddress, isAddress } from "viem";

import { createDb } from "../db/client.js";
import { tokens, userProfiles } from "../db/schema.js";
import { setEdgeCacheHeaders } from "../utils/cache-control.js";
import formatError from "../utils/format-error.js";
import formatSuccess from "../utils/format-success.js";
import { tryApiDbRead } from "../lib/api-db-reads.js";
import {
  fetchCreatorEarnings,
  fetchCreatorVolumesByAddresses,
} from "../lib/indexer-reads.js";
import { usdcRawToUsd } from "../lib/token-enrich.js";

import type { AppBindings } from "../lib/types.js";

const creators = new Hono<{ Bindings: AppBindings }>();

const VOLUME_QUERY_PAGE_SIZE = 1000;
const EARNINGS_CACHE_TTL_SECONDS = 15;
const PROFILE_CACHE_TTL_SECONDS = 30;

/**
 * Per-creator pooled earnings totals. Reads the precomputed
 * `creator_earnings` row maintained by the indexer
 * (`apps/indexer/src/feeVault.ts`) — a single primary-key lookup
 * replaces the legacy frontend pattern of two `eth_call`s against
 * `FeeVault.creatorBalance` / `lifetimeCreatorEarned` per 30s poll
 * per page that mounts the rewards / profile / creator-badge surface.
 *
 * Edge-cached for 15s so a viral page-load fans 1 request per region
 * per 15s through to the indexer DB. Matches the freshness window of
 * the rewards panel's poll cadence — a 30s poll on top of a 15s edge
 * cache means worst-case staleness from a creator's perspective is
 * ~45s (and almost always <30s in practice once the SWR window kicks
 * in).
 *
 * `claimable` is derived as `max(0, lifetimeEarned − lifetimeClaimed)`.
 * The two counters are bumped from independent events
 * (`FeeAccrued` / `CreatorFeesClaimed`) so a sub-block ordering quirk
 * during indexer catch-up could briefly produce `claimed > earned`;
 * the floor in this read path absorbs that drift instead of compounding
 * it into the persisted row.
 */
creators.get("/:address/earnings", async (c) => {
  const rawAddress = c.req.param("address");
  if (!isAddress(rawAddress)) {
    return c.json(formatError("Invalid address"), 400);
  }
  const address = getAddress(rawAddress);

  const db = createDb(c.env.DATABASE_URL);
  const result = await fetchCreatorEarnings(db, address);

  if (result === "unavailable") {
    return c.json(
      formatError("Indexer unavailable — earnings data cannot be loaded"),
      503,
    );
  }

  setEdgeCacheHeaders(c, EARNINGS_CACHE_TTL_SECONDS);

  // Steady state for any wallet that's never launched a token (or
  // launched but never accrued a fee): no row yet. Ship a clean
  // zero-state shape so the frontend doesn't need to special-case
  // `null` on the response, and a brand-new creator's first read after
  // launch lands a deterministic payload.
  if (result === null) {
    return c.json(
      formatSuccess({
        lifetimeEarnedUsdcRaw: "0",
        lifetimeClaimedUsdcRaw: "0",
        claimableUsdcRaw: "0",
        lifetimeEarnedUsd: 0,
        lifetimeClaimedUsd: 0,
        claimableUsd: 0,
      }),
    );
  }

  const earnedRaw = BigInt(result.lifetimeEarnedUsdcRaw);
  const claimedRaw = BigInt(result.lifetimeClaimedUsdcRaw);
  // Floor at zero — see route-level docstring for why this lives in
  // the read path rather than at write time.
  const claimableRaw = earnedRaw > claimedRaw ? earnedRaw - claimedRaw : 0n;

  // `usdcRawToUsd` returns `number | null` so callers can distinguish
  // "indexer didn't report a value" from "value was 0". Here every
  // input is a defined raw string we just built, so the null branch is
  // unreachable — `?? 0` exists only to discharge the type union.
  return c.json(
    formatSuccess({
      lifetimeEarnedUsdcRaw: earnedRaw.toString(),
      lifetimeClaimedUsdcRaw: claimedRaw.toString(),
      claimableUsdcRaw: claimableRaw.toString(),
      lifetimeEarnedUsd: usdcRawToUsd(result.lifetimeEarnedUsdcRaw) ?? 0,
      lifetimeClaimedUsd: usdcRawToUsd(result.lifetimeClaimedUsdcRaw) ?? 0,
      claimableUsd: usdcRawToUsd(claimableRaw.toString()) ?? 0,
    }),
  );
});

/**
 * Creator profile + their tokens + aggregate stats. The volume aggregate now
 * sums each token's `volumeUsd` counter (maintained in lockstep with every
 * Buy/Sell on the indexer) instead of paginating up to 20K trades on every
 * request (issue #397). One indexed query, O(N tokens), no per-trade scan.
 *
 * Realistic creators have <50 tokens; the page-size cap exists only to bound
 * pathological cases where a single address has launched thousands.
 */
creators.get("/:address", async (c) => {
  const rawAddress = c.req.param("address");
  if (!isAddress(rawAddress)) {
    return c.json(formatError("Invalid address"), 400);
  }
  const address = getAddress(rawAddress);
  const db = createDb(c.env.DATABASE_URL);

  const profileRows = await tryApiDbRead(
    "api_db.creator_profile_lookup",
    () =>
      db
        .select()
        .from(userProfiles)
        .where(eq(userProfiles.address, address))
        .limit(1),
    { address },
  );
  if (profileRows === null) {
    return c.json(formatError("Creator profile unavailable"), 503);
  }
  const [profile] = profileRows;

  // Drop hidden tokens so a creator profile doesn't leak admin-removed
  // launches back into the UI (issue #586). Matches the listing /
  // search / detail behaviour — `isHidden = false` is the public lens.
  const creatorTokens = await tryApiDbRead(
    "api_db.creator_tokens_lookup",
    () =>
      db
        .select()
        .from(tokens)
        .where(and(eq(tokens.creator, address), eq(tokens.isHidden, false))),
    { address },
  );
  if (creatorTokens === null) {
    return c.json(formatError("Creator tokens unavailable"), 503);
  }

  let totalVolume = 0n;
  if (creatorTokens.length > 0) {
    const tokenAddresses = creatorTokens.map((t) => t.address.toLowerCase());

    // Single indexed lookup against the per-token `volumeUsd` counter.
    // Capped to PAGE_SIZE so a creator with thousands of tokens doesn't
    // explode the query — terminal-API callers in that situation should
    // page through `tokens` directly. Helper short-circuits when the
    // address list is empty; we already gated on `creatorTokens.length > 0`
    // above but the lower layer is defensive too.
    const volumeRows = await fetchCreatorVolumesByAddresses(
      db,
      tokenAddresses,
      VOLUME_QUERY_PAGE_SIZE,
    );

    // Null = indexer DB read failed. Skip the aggregate rather than 503ing
    // the whole creator profile — the page still renders with the
    // PostgreSQL-sourced profile + tokens list and a `totalVolume: "0"`
    // sentinel. Matches the prior GraphQL-null behaviour (`?? []`).
    for (const t of volumeRows ?? []) {
      totalVolume += BigInt(t.volumeUsd ?? "0");
    }
  }

  setEdgeCacheHeaders(c, PROFILE_CACHE_TTL_SECONDS);
  return c.json(
    formatSuccess({
      profile: profile ?? null,
      tokens: creatorTokens,
      stats: {
        tokensCreated: creatorTokens.length,
        totalVolume: totalVolume.toString(),
      },
    }),
  );
});

export default creators;
