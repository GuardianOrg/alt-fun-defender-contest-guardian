import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { getAddress, isAddress } from "viem";

import { createDb } from "../db/client.js";
import { tokens, userProfiles } from "../db/schema.js";
import formatError from "../utils/format-error.js";
import formatSuccess from "../utils/format-success.js";
import { createPonderQuery } from "../lib/ponder-client.js";
import { fetchCreatorEarnings } from "../lib/indexer-reads.js";
import { usdcRawToUsd } from "../lib/token-enrich.js";

import type { AppBindings } from "../lib/types.js";

const creators = new Hono<{ Bindings: AppBindings }>();

interface PonderTokenVolume {
  address: string;
  volumeUsd: string;
}

const VOLUME_QUERY_PAGE_SIZE = 1000;

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

  c.header(
    "Cache-Control",
    "public, s-maxage=15, stale-while-revalidate=30",
  );

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

  const [profile] = await db
    .select()
    .from(userProfiles)
    .where(eq(userProfiles.address, address))
    .limit(1);

  // Drop hidden tokens so a creator profile doesn't leak admin-removed
  // launches back into the UI (issue #586). Matches the listing /
  // search / detail behaviour — `isHidden = false` is the public lens.
  const creatorTokens = await db
    .select()
    .from(tokens)
    .where(and(eq(tokens.creator, address), eq(tokens.isHidden, false)));

  let totalVolume = 0n;
  if (creatorTokens.length > 0) {
    const tokenAddresses = creatorTokens.map((t) => t.address.toLowerCase());

    // Single indexed lookup against the per-token `volumeUsd` counter.
    // Capped to PAGE_SIZE so a creator with thousands of tokens doesn't
    // explode the query — terminal-API callers in that situation should
    // page through `tokens` directly.
    const queryPonder = createPonderQuery(c.env.PONDER_URL);
    const volumeData = await queryPonder<{
      tokens: { items: PonderTokenVolume[] } | null;
    }>(
      `query ($addresses: [String!]!, $limit: Int!) {
        tokens(where: { address_in: $addresses }, limit: $limit) {
          items {
            address
            volumeUsd
          }
        }
      }`,
      { addresses: tokenAddresses, limit: VOLUME_QUERY_PAGE_SIZE },
    );

    for (const t of volumeData?.tokens?.items ?? []) {
      totalVolume += BigInt(t.volumeUsd ?? "0");
    }
  }

  c.header(
    "Cache-Control",
    "public, s-maxage=30, stale-while-revalidate=60",
  );
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
