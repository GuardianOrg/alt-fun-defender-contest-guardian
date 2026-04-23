import { Hono } from "hono";
import { getAddress, isAddress } from "viem";

import { createPonderPaginatedQuery } from "../../lib/ponder-client.js";
import formatError from "../../utils/format-error.js";
import formatSuccess from "../../utils/format-success.js";

import type { AppBindings } from "../../lib/types.js";
import type { PonderFeeAccrual } from "../../lib/ponder-types.js";

const earningsRoute = new Hono<{ Bindings: AppBindings }>();

/**
 * Per-token creator earnings. Sums `FeeVault.FeeAccrued.creatorAmount` (USDC,
 * 6dp) for the given token — the accrual stream is the source of truth for
 * "how much has this token earned its creator" because claims are lumpy and
 * pool together fees across every token the creator has launched.
 *
 * Also returns `protocolFeesUsd` for parity with the admin dashboard.
 */
earningsRoute.get("/:address/earnings", async (c) => {
  const rawAddress = c.req.param("address");
  if (!isAddress(rawAddress)) {
    return c.json(formatError("Invalid address"), 400);
  }
  const address = getAddress(rawAddress);

  const queryAll = createPonderPaginatedQuery(c.env.PONDER_URL);
  const { items: accruals, truncated } = await queryAll<PonderFeeAccrual>(
    `query ($limit: Int!, $offset: Int!, $tokenAddress: String!) {
      feeAccruals(
        where: { tokenAddress: $tokenAddress }
        limit: $limit, offset: $offset,
        orderBy: "timestamp", orderDirection: "desc"
      ) {
        items { creatorAmount protocolAmount timestamp }
      }
    }`,
    "feeAccruals",
    { tokenAddress: address.toLowerCase() },
  );

  let creatorRaw = 0n;
  let protocolRaw = 0n;
  for (const a of accruals) {
    creatorRaw += BigInt(a.creatorAmount);
    protocolRaw += BigInt(a.protocolAmount);
  }

  return c.json(
    formatSuccess({
      tokenAddress: address,
      // USDC has 6 decimals.
      creatorFeesUsd: Number(creatorRaw) / 1e6,
      protocolFeesUsd: Number(protocolRaw) / 1e6,
      totalFeesUsd: Number(creatorRaw + protocolRaw) / 1e6,
      accrualCount: accruals.length,
      truncated,
    }),
  );
});

export default earningsRoute;
