import { Hono } from "hono";
import { isAddress } from "viem";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";

import {
  RegistrationError,
  broadcastNewToken,
  registerTokenFromChain,
} from "../../lib/token-registration.js";
import formatError from "../../utils/format-error.js";
import formatSuccess from "../../utils/format-success.js";
import { zodValidator } from "../../utils/validation.js";

import type { AppBindings } from "../../lib/types.js";

/**
 * Token registration is **address-only**. Every other field (name, ticker,
 * description, image, socials, LT pair, creator) is read from
 * `Bonding.getTokenInfo` server-side. No signature is required: the row
 * we'd write for a stranger calling this on someone else's freshly-launched
 * token is byte-identical to the row the legitimate creator would produce,
 * because the on-chain state is the source of truth. Idempotent at the DB
 * layer, so the frontend's synchronous await and the cron backfill can race
 * harmlessly. See `lib/token-registration.ts` for the full rationale.
 *
 * Response codes:
 *   - 201: newly inserted
 *   - 200: already existed (idempotent OK; the frontend treats this as success)
 *   - 400: invalid address
 *   - 404: token not found on-chain
 *   - 422: image URL or LT failed validation
 *   - 500: internal error during registration (e.g. unrecoverable DB write race)
 *   - 502: upstream RPC / BounceTech unavailable
 */
const registerTokenSchema = z.object({
  address: z.string().refine(isAddress, "Invalid address"),
});

const createRoute = new Hono<{ Bindings: AppBindings }>();

createRoute.post("/", zodValidator("json", registerTokenSchema), async (c) => {
  const { address } = c.req.valid("json");

  try {
    const apiOrigin = new URL(c.req.url).origin;
    const result = await registerTokenFromChain(c.env, address, apiOrigin);
    if (result.kind === "registered") {
      c.executionCtx.waitUntil(broadcastNewToken(c.env, result.token));
      return c.json(formatSuccess(result.token), 201);
    }
    return c.json(formatSuccess(result.token), 200);
  } catch (err) {
    if (err instanceof RegistrationError) {
      return c.json(formatError(err.message), err.status as ContentfulStatusCode);
    }
    throw err;
  }
});

export default createRoute;
