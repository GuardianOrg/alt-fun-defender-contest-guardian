import { buildTokenCreationMessage } from "@launchpad/shared";
import { eq, desc, ilike, or, inArray, and } from "drizzle-orm";
import { Hono } from "hono";
import { getAddress, isAddress, recoverMessageAddress } from "viem";

import { createDb } from "../db/client.js";
import { tokens } from "../db/schema.js";
import formatError from "../utils/format-error.js";
import formatSuccess from "../utils/format-success.js";

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

  const db = createDb(c.env.DATABASE_URL);
  const allTokens = await db
    .select()
    .from(tokens)
    .where(eq(tokens.isHidden, false))
    .orderBy(desc(tokens.createdAt))
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
  const address = c.req.param("address");
  const db = createDb(c.env.DATABASE_URL);
  const [token] = await db.select().from(tokens).where(eq(tokens.address, address)).limit(1);

  if (!token) {
    return c.json(formatError("Token not found"), 404);
  }

  return c.json(formatSuccess(token));
});

tokensRoute.post("/", async (c) => {
  let body: {
    address: string;
    name: string;
    ticker: string;
    description?: string;
    imageUrl?: string;
    ltPair: string;
    ltDirection: string;
    leverage: number;
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
      creator: normalizedCreator,
    })
    .onConflictDoNothing()
    .returning();

  if (!token) {
    return c.json(formatError("Token already exists"), 409);
  }

  return c.json(formatSuccess(token), 201);
});

export default tokensRoute;
