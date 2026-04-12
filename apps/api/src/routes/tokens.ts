import { buildTokenCreationMessage } from "@launchpad/shared";
import { eq, desc, asc, ilike, or, inArray, and, type SQL } from "drizzle-orm";
import { Hono } from "hono";
import { getAddress, isAddress, recoverMessageAddress } from "viem";

import { createDb } from "../db/client.js";
import { tokens } from "../db/schema.js";
import formatError from "../utils/format-error.js";
import formatSuccess from "../utils/format-success.js";
import { createPonderQuery } from "../lib/ponder-client.js";
import { broadcastToChannel } from "../lib/broadcast.js";

import type { AppBindings } from "../lib/types.js";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

function parseNonNegativeInt(value: string | undefined): number | undefined | null {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) return null;
  return Number.parseInt(value, 10);
}

const tokensRoute = new Hono<{ Bindings: AppBindings }>();

tokensRoute.get("/", async (c) => {
  const limitParam = parseNonNegativeInt(c.req.query("limit"));
  const offsetParam = parseNonNegativeInt(c.req.query("offset"));

  if (limitParam === null || offsetParam === null) {
    return c.json(formatError("Invalid pagination parameters"), 400);
  }

  const limit = Math.min(limitParam ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const offset = offsetParam ?? 0;

  const conditions: SQL[] = [eq(tokens.isHidden, false)];

  const underlying = c.req.query("underlying");
  if (underlying) {
    conditions.push(eq(tokens.underlying, underlying));
  }

  const status = c.req.query("status");
  if (status && (status === "curve" || status === "graduating" || status === "graduated")) {
    conditions.push(eq(tokens.status, status));
  }

  const direction = c.req.query("direction");
  if (direction && (direction === "long" || direction === "short")) {
    conditions.push(eq(tokens.ltDirection, direction));
  }

  const leverage = c.req.query("leverage");
  if (leverage) {
    const lev = parseInt(leverage, 10);
    if ([2, 3, 5].includes(lev)) {
      conditions.push(eq(tokens.leverage, lev));
    }
  }

  const creator = c.req.query("creator");
  if (creator && isAddress(creator)) {
    conditions.push(eq(tokens.creator, getAddress(creator)));
  }

  const sort = c.req.query("sort") ?? "createdAt";
  const dir = c.req.query("dir") === "asc" ? asc : desc;

  const sortColumn =
    sort === "leverage" ? tokens.leverage :
    sort === "name" ? tokens.name :
    tokens.createdAt;

  const db = createDb(c.env.DATABASE_URL);
  const allTokens = await db
    .select()
    .from(tokens)
    .where(and(...conditions))
    .orderBy(dir(sortColumn))
    .limit(limit)
    .offset(offset);

  return c.json(formatSuccess(allTokens));
});

tokensRoute.get("/search", async (c) => {
  const q = c.req.query("q");
  if (!q || q.length < 1) {
    return c.json(formatSuccess([]));
  }

  const db = createDb(c.env.DATABASE_URL);
  const pattern = `%${q}%`;
  const results = await db
    .select()
    .from(tokens)
    .where(
      and(
        eq(tokens.isHidden, false),
        or(
          ilike(tokens.name, pattern),
          ilike(tokens.ticker, pattern),
          ilike(tokens.address, pattern),
        ),
      ),
    )
    .limit(20);

  return c.json(formatSuccess(results));
});

tokensRoute.post("/batch", async (c) => {
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

tokensRoute.get("/:address", async (c) => {
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

tokensRoute.post("/", async (c) => {
  let body: {
    address: string;
    name: string;
    ticker: string;
    description?: string;
    imageUrl?: string;
    ltPair: string;
    ltDirection?: string;
    leverage?: number;
    underlying?: string;
    twitterUrl?: string;
    telegramUrl?: string;
    websiteUrl?: string;
    creator: string;
    signature: string;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json(formatError("Invalid JSON body"), 400);
  }

  if (
    !body.address ||
    !body.name ||
    !body.ticker ||
    !body.ltPair ||
    !body.creator ||
    !body.signature
  ) {
    return c.json(formatError("Missing required fields"), 400);
  }

  if (!isAddress(body.address) || !isAddress(body.creator)) {
    return c.json(formatError("Invalid address"), 400);
  }

  const normalizedAddress = getAddress(body.address);
  const normalizedCreator = getAddress(body.creator);

  const message = buildTokenCreationMessage({
    address: normalizedAddress,
    name: body.name,
    ticker: body.ticker,
    description: body.description ?? "",
    imageUrl: body.imageUrl ?? "",
    ltPair: body.ltPair,
    ltDirection: body.ltDirection ?? "long",
    leverage: body.leverage ?? 2,
    creator: normalizedCreator,
  });

  let recoveredAddress: string;
  try {
    recoveredAddress = await recoverMessageAddress({
      message,
      signature: body.signature as `0x${string}`,
    });
  } catch {
    return c.json(formatError("Invalid signature"), 401);
  }

  if (getAddress(recoveredAddress) !== normalizedCreator) {
    return c.json(formatError("Signature does not match creator"), 401);
  }

  const db = createDb(c.env.DATABASE_URL);
  const [token] = await db
    .insert(tokens)
    .values({
      address: normalizedAddress,
      name: body.name,
      ticker: body.ticker,
      description: body.description ?? "",
      imageUrl: body.imageUrl ?? "",
      ltPair: body.ltPair,
      ltDirection: body.ltDirection ?? "long",
      leverage: body.leverage ?? 2,
      underlying: body.underlying ?? "HYPE",
      twitterUrl: body.twitterUrl ?? "",
      telegramUrl: body.telegramUrl ?? "",
      websiteUrl: body.websiteUrl ?? "",
      creator: normalizedCreator,
    })
    .onConflictDoNothing()
    .returning();

  if (!token) {
    return c.json(formatError("Token already exists"), 409);
  }

  c.executionCtx.waitUntil(broadcastToChannel(c.env, "newToken", token).catch(() => {}));

  return c.json(formatSuccess(token), 201);
});

export default tokensRoute;
