import { eq, and, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { getAddress, isAddress } from "viem";

import { createDb } from "../../db/client.js";
import { tokens } from "../../db/schema.js";
import formatError from "../../utils/format-error.js";
import formatSuccess from "../../utils/format-success.js";
import { createPonderQuery } from "../../lib/ponder-client.js";

import type { AppBindings } from "../../lib/types.js";

const detailRoute = new Hono<{ Bindings: AppBindings }>();

detailRoute.post("/batch", async (c) => {
  let body: { addresses: string[] };
  try {
    body = await c.req.json<{ addresses: string[] }>();
  } catch {
    return c.json(formatError("Invalid JSON body"), 400);
  }
  if (!body.addresses || body.addresses.length === 0) {
    return c.json(formatSuccess([]));
  }
  if (body.addresses.length > 100) {
    return c.json(formatError("Maximum 100 addresses per batch"), 400);
  }

  const db = createDb(c.env.DATABASE_URL);
  const results = await db
    .select()
    .from(tokens)
    .where(and(eq(tokens.isHidden, false), inArray(tokens.address, body.addresses)));

  return c.json(formatSuccess(results));
});

detailRoute.get("/:address", async (c) => {
  const rawAddress = c.req.param("address");
  if (!isAddress(rawAddress)) {
    return c.json(formatError("Invalid address"), 400);
  }
  const address = getAddress(rawAddress);
  const db = createDb(c.env.DATABASE_URL);
  const [dbToken] = await db.select().from(tokens).where(eq(tokens.address, address)).limit(1);

  if (!dbToken) {
    return c.json(formatError("Token not found"), 404);
  }

  const queryPonder = createPonderQuery(c.env.PONDER_URL);
  const ponderData = await queryPonder<{
    token: {
      curveSupply: string;
      ltReserve: string;
      graduated: boolean;
      graduatedAt: string | null;
      pairAddress: string | null;
    } | null;
  }>(
    `query ($address: String!) {
      token(id: $address) {
        curveSupply
        ltReserve
        graduated
        graduatedAt
        pairAddress
      }
    }`,
    { address },
  );

  const onchain = ponderData?.token;
  const totalSupply = 1_000_000_000n * 10n ** 18n;
  const curveAllocation = (totalSupply * 75n) / 100n;

  let curveFilled = 0;
  if (onchain?.curveSupply) {
    const remaining = BigInt(onchain.curveSupply);
    const sold = remaining >= curveAllocation ? 0n : curveAllocation - remaining;
    curveFilled = Math.min(Number((sold * 10000n) / curveAllocation) / 100, 100);
  }

  const computedStatus = onchain?.graduated ? "graduated" : curveFilled >= 90 ? "graduating" : "curve";

  return c.json(formatSuccess({
    ...dbToken,
    curveSupply: onchain?.curveSupply ?? "0",
    ltReserve: onchain?.ltReserve ?? "0",
    curveFilled,
    status: computedStatus,
    graduatedAt: onchain?.graduatedAt ? new Date(Number(onchain.graduatedAt) * 1000).toISOString() : dbToken.graduatedAt,
    poolAddress: onchain?.pairAddress ?? dbToken.poolAddress,
  }));
});

export default detailRoute;
