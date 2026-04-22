import {
  MAX_TOKEN_NAME_LENGTH,
  MAX_TOKEN_SYMBOL_LENGTH,
  MIN_TOKEN_NAME_LENGTH,
  MIN_TOKEN_SYMBOL_LENGTH,
  buildTokenCreationMessage,
} from "@launchpad/shared";
import { Hono } from "hono";
import { getAddress, isAddress, recoverMessageAddress } from "viem";
import { z } from "zod";

import { createDb } from "../../db/client.js";
import { tokens } from "../../db/schema.js";
import formatError from "../../utils/format-error.js";
import formatSuccess from "../../utils/format-success.js";
import { broadcastToChannel } from "../../lib/broadcast.js";
import { zodValidator } from "../../utils/validation.js";

import type { AppBindings } from "../../lib/types.js";

const createTokenSchema = z.object({
  address: z.string().refine(isAddress, "Invalid address"),
  name: z
    .string()
    .min(MIN_TOKEN_NAME_LENGTH, "Name is required")
    .max(MAX_TOKEN_NAME_LENGTH, `Name too long (max ${MAX_TOKEN_NAME_LENGTH} chars)`),
  ticker: z
    .string()
    .min(MIN_TOKEN_SYMBOL_LENGTH, "Ticker is required")
    .max(MAX_TOKEN_SYMBOL_LENGTH, `Ticker too long (max ${MAX_TOKEN_SYMBOL_LENGTH} chars)`),
  description: z.string().optional().default(""),
  imageUrl: z.string().optional().default(""),
  ltPair: z.string().refine(isAddress, "Invalid LT pair address"),
  ltDirection: z.enum(["long", "short"]).optional().default("long"),
  leverage: z.number().optional().default(2),
  underlying: z.string().optional().default("HYPE"),
  twitterUrl: z.string().optional().default(""),
  telegramUrl: z.string().optional().default(""),
  websiteUrl: z.string().optional().default(""),
  creator: z.string().refine(isAddress, "Invalid creator address"),
  signature: z.string().min(1, "Signature is required"),
});

const createRoute = new Hono<{ Bindings: AppBindings }>();

createRoute.post("/", zodValidator("json", createTokenSchema), async (c) => {
  const body = c.req.valid("json");

  const normalizedAddress = getAddress(body.address);
  const normalizedCreator = getAddress(body.creator);

  const message = buildTokenCreationMessage({
    address: normalizedAddress,
    name: body.name,
    ticker: body.ticker,
    description: body.description,
    imageUrl: body.imageUrl,
    ltPair: body.ltPair,
    ltDirection: body.ltDirection,
    leverage: body.leverage,
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
      description: body.description,
      imageUrl: body.imageUrl,
      ltPair: body.ltPair,
      ltDirection: body.ltDirection,
      leverage: body.leverage,
      underlying: body.underlying,
      twitterUrl: body.twitterUrl,
      telegramUrl: body.telegramUrl,
      websiteUrl: body.websiteUrl,
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
