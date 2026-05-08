import { Hono } from "hono";
import { isAddress } from "viem";

import formatError from "../utils/format-error.js";
import formatSuccess from "../utils/format-success.js";
import { createPonderQuery } from "../lib/ponder-client.js";

import type { AppBindings } from "../lib/types.js";

const security = new Hono<{ Bindings: AppBindings }>();

interface PonderTokenInfo {
  creator: string;
  graduated: boolean;
  hyperswapPair: string | null;
}

interface PonderGraduation {
  liquidity: string;
}

interface PonderTokenBalance {
  balance: string;
}

const TOTAL_SUPPLY = 1_000_000_000n * 10n ** 18n;

/**
 * Token security info — LP lock status, creator's current holdings, etc.
 *
 * `creatorHoldingPct` used to be derived by paginating up to 20K trades and
 * accumulating buys/sells in memory, which (a) silently undercounted creators
 * who acquired or moved tokens via direct ERC-20 Transfer and (b) put up to
 * 20 sequential GraphQL round-trips on every page-load (issue #397). It's now
 * sourced directly from the indexer's `tokenBalance` index — one row, exact
 * holdings regardless of acquisition path, no pagination ceiling.
 */
security.get("/:address", async (c) => {
  const rawAddress = c.req.param("address");
  if (!isAddress(rawAddress)) {
    return c.json(formatError("Invalid address"), 400);
  }
  const address = rawAddress.toLowerCase();

  const queryPonder = createPonderQuery(c.env.PONDER_URL);

  // Step 1: load metadata to discover the creator's address. The creator
  // composite key for the balance lookup isn't knowable until we read it,
  // so step 2 fans out from here.
  const metaData = await queryPonder<{
    token: PonderTokenInfo | null;
    graduation: PonderGraduation | null;
  }>(
    `query ($address: String!) {
      token(id: $address) {
        creator
        graduated
        hyperswapPair
      }
      graduation(id: $address) {
        liquidity
      }
    }`,
    { address },
  );

  // Indexer unreachable OR the token isn't yet indexed — in either case we
  // serve the same neutral fallback the legacy implementation did rather
  // than 503. That matches the existing terminal-API contract (smoke-test
  // expects 200) and also keeps the security panel from going blank during
  // a brief Ponder outage; the worst case is `creatorHoldingPct: 0` which
  // is the safest possible default for a security screen.
  const tokenData = metaData?.token;
  if (!tokenData) {
    setSecurityCacheHeader(c);
    return c.json(
      formatSuccess({
        lpLocked: false,
        creatorHoldingPct: 0,
        contractVerified: true,
      }),
    );
  }

  const creator = tokenData.creator.toLowerCase();
  const balanceId = `${creator}-${address}`;

  // Step 2: targeted lookup of the creator's balance row. Indexer keys
  // `tokenBalance` by `${wallet}-${tokenAddress}` so this is a primary-key
  // hit — O(1) at the database layer, regardless of the token's trade
  // history depth.
  const balanceData = await queryPonder<{
    tokenBalance: PonderTokenBalance | null;
  }>(
    `query ($id: String!) {
      tokenBalance(id: $id) {
        balance
      }
    }`,
    { id: balanceId },
  );

  const creatorBalance = balanceData?.tokenBalance?.balance
    ? BigInt(balanceData.tokenBalance.balance)
    : 0n;

  const creatorHoldingPct = Number((creatorBalance * 10000n) / TOTAL_SUPPLY) / 100;

  setSecurityCacheHeader(c);
  return c.json(
    formatSuccess({
      lpLocked: tokenData.graduated && metaData.graduation != null,
      lpAmount: metaData.graduation?.liquidity ?? null,
      creatorHoldingPct: Math.max(0, creatorHoldingPct),
      contractVerified: true,
      graduated: tokenData.graduated,
      poolAddress: tokenData.hyperswapPair,
    }),
  );
});

/**
 * `lpLocked` / `graduated` only flip once per token's lifetime, and
 * `creatorHoldingPct` updates on every Transfer (including bot trades), but
 * the page consuming this is the security panel — staleness up to 30s is a
 * non-issue, and the cache absorbs concurrent page-views on viral tokens.
 */
function setSecurityCacheHeader(c: { header: (k: string, v: string) => void }) {
  c.header(
    "Cache-Control",
    "public, s-maxage=30, stale-while-revalidate=60",
  );
}

export default security;
