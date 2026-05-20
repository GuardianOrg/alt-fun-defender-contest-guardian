import { buildSessionMessage, sanitizeTwitterHandle, SESSION_DURATION_MS } from "@launchpad/shared";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { getAddress, isAddress, recoverMessageAddress } from "viem";
import { z } from "zod";

import { createDb } from "../db/client.js";
import { userProfiles } from "../db/schema.js";
import { tryApiDbRead } from "../lib/api-db-reads.js";
import formatError from "../utils/format-error.js";
import formatSuccess from "../utils/format-success.js";
import { zodValidator } from "../utils/validation.js";

import type { AppBindings } from "../lib/types.js";

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
  // Stored as a bare Twitter / X handle (see issue #400). We accept any
  // common form on the wire — `@alice`, `alice`, `https://x.com/alice`,
  // `https://twitter.com/alice/status/123` — and reject anything that
  // doesn't reduce to a valid handle (e.g. `javascript:alert(1)`,
  // `https://x.com.evil.tld/foo`). The handle is what gets persisted; the
  // frontend always rebuilds the URL via `buildTwitterUrl`.
  twitterUrl: z
    .string()
    .max(200, "Twitter URL too long (max 200 chars)")
    .optional()
    .default("")
    .superRefine((value, ctx) => {
      if (value.trim() === "") return;
      if (sanitizeTwitterHandle(value) === "") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Must be a Twitter / X handle or x.com URL",
        });
      }
    })
    .transform((value) => sanitizeTwitterHandle(value)),
  signature: z.string().min(1, "Signature is required"),
  expiresAt: z.number().finite("Invalid expiresAt"),
});

const profilesRoute = new Hono<{ Bindings: AppBindings }>();

/**
 * Pre-#400 rows may still hold raw URLs in `twitterUrl` (e.g.
 * `https://twitter.com/alice` or, worse, `javascript:...`). The PUT
 * handler now stores the bare handle, but historical rows haven't been
 * migrated. Sanitising on read collapses both shapes to the canonical
 * handle so every response the frontend sees is safe to feed into
 * `buildTwitterUrl`. An empty / unsafe stored value reads back as `null`,
 * matching the "no profile" branch above.
 */
function sanitizeProfileForResponse<T extends { twitterUrl?: string | null }>(profile: T): T {
  const handle = sanitizeTwitterHandle(profile.twitterUrl ?? "");
  return { ...profile, twitterUrl: handle === "" ? null : handle };
}

profilesRoute.get("/:address", async (c) => {
  const rawAddress = c.req.param("address");
  if (!isAddress(rawAddress)) {
    return c.json(formatError("Invalid address"), 400);
  }
  const address = getAddress(rawAddress);

  const db = createDb(c.env.HYPERDRIVE.connectionString);
  const profileRows = await tryApiDbRead(
    "api_db.profile_lookup",
    () =>
      db
        .select()
        .from(userProfiles)
        .where(eq(userProfiles.address, address)),
    { address },
  );
  if (profileRows === null) {
    return c.json(formatError("Profile data unavailable"), 503);
  }
  const [profile] = profileRows;

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

  return c.json(formatSuccess(sanitizeProfileForResponse(profile)));
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

    const now = Date.now();
    if (now >= body.expiresAt) {
      return c.json(formatError("Session signature has expired"), 401);
    }
    // Cap the client-supplied `expiresAt` server-side. Without this, a
    // malicious client can sign a message valid for years and replay it
    // indefinitely (issue #393). Allow a small skew so freshly-issued
    // sessions from a slightly-ahead client are still accepted.
    const MAX_CLOCK_SKEW_MS = 60_000;
    if (body.expiresAt > now + SESSION_DURATION_MS + MAX_CLOCK_SKEW_MS) {
      return c.json(formatError("Session signature lifetime exceeds maximum"), 401);
    }

    const message = buildSessionMessage(address, body.expiresAt);

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

    const db = createDb(c.env.HYPERDRIVE.connectionString);
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

    return c.json(formatSuccess(sanitizeProfileForResponse(profile)));
  },
);

export default profilesRoute;
