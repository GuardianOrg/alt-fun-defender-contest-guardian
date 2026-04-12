import { buildTokenCreationMessage } from "@launchpad/shared";
import { Hono } from "hono";
import { getAddress, isAddress, recoverMessageAddress } from "viem";

import { createDb } from "../../db/client.js";
import { tokens } from "../../db/schema.js";
import formatError from "../../utils/format-error.js";
import formatSuccess from "../../utils/format-success.js";
import { broadcastToChannel } from "../../lib/broadcast.js";

import type { AppBindings } from "../../lib/types.js";

const createRoute = new Hono<{ Bindings: AppBindings }>();

createRoute.post("/", async (c) => {
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

export default createRoute;
