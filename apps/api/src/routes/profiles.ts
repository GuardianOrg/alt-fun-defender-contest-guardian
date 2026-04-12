import { buildProfileUpdateMessage } from "@launchpad/shared";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { getAddress, isAddress, recoverMessageAddress } from "viem";
import { z } from "zod";

import { createDb } from "../db/client.js";
import { userProfiles } from "../db/schema.js";
import formatError from "../utils/format-error.js";
import formatSuccess from "../utils/format-success.js";
import { zodValidator } from "../utils/validation.js";

import type { AppBindings } from "../lib/types.js";

const PROFILE_SIGNATURE_TTL_MS = 5 * 60_000;

const updateProfileSchema = z.object({
  displayName: z
    .string()
    .max(50, "Display name too long (max 50 chars)")
    .optional()
    .default(""),
  bio: z
    .string()
    .max(280, "Bio too long (max 280 chars)")
    .optional()
    .default(""),
  twitterUrl: z
    .string()
    .max(200, "Twitter URL too long (max 200 chars)")
    .optional()
    .default(""),
  signature: z.string().min(1, "Signature is required"),
  timestamp: z.number().finite("Invalid timestamp"),
});

const profilesRoute = new Hono<{ Bindings: AppBindings }>();

profilesRoute.get("/:address", async (c) => {
  const rawAddress = c.req.param("address");
  if (!isAddress(rawAddress)) {
    return c.json(formatError("Invalid address"), 400);
  }
  const address = getAddress(rawAddress);

  const db = createDb(c.env.DATABASE_URL);
  const [profile] = await db
    .select()
    .from(userProfiles)
    .where(eq(userProfiles.address, address));

  if (!profile) {
    return c.json(
      formatSuccess({
        address,
        displayName: null,
        bio: null,
        twitterUrl: null,
        totalVolume: "0",
        totalTrades: 0,
        updatedAt: null,
      }),
    );
  }

  return c.json(formatSuccess(profile));
});

profilesRoute.put(
  "/:address",
  zodValidator("json", updateProfileSchema),
  async (c) => {
    const rawAddress = c.req.param("address");
    if (!isAddress(rawAddress)) {
      return c.json(formatError("Invalid address"), 400);
    }
    const address = getAddress(rawAddress);

    const body = c.req.valid("json");

    if (Math.abs(Date.now() - body.timestamp) > PROFILE_SIGNATURE_TTL_MS) {
      return c.json(formatError("Expired signature timestamp"), 401);
    }

    const message = buildProfileUpdateMessage({
      address,
      displayName: body.displayName,
      bio: body.bio,
      twitterUrl: body.twitterUrl,
      timestamp: body.timestamp,
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

    if (getAddress(recoveredAddress) !== address) {
      return c.json(formatError("Signature does not match address"), 401);
    }

    const db = createDb(c.env.DATABASE_URL);
    const [profile] = await db
      .insert(userProfiles)
      .values({
        address,
        displayName: body.displayName || null,
        bio: body.bio || null,
        twitterUrl: body.twitterUrl || null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: userProfiles.address,
        set: {
          displayName: body.displayName || null,
          bio: body.bio || null,
          twitterUrl: body.twitterUrl || null,
          updatedAt: new Date(),
        },
      })
      .returning();

    return c.json(formatSuccess(profile));
  },
);

export default profilesRoute;
