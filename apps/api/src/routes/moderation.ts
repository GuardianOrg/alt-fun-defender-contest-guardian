import { buildSessionMessage, SESSION_DURATION_MS } from "@launchpad/shared";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { getAddress, isAddress, recoverMessageAddress } from "viem";
import { z } from "zod";

import { createDb } from "../db/client.js";
import { tokens } from "../db/schema.js";
import { getAdminWallets, isAdminFor } from "../lib/admin-allowlist.js";
import formatError from "../utils/format-error.js";
import formatSuccess from "../utils/format-success.js";
import { zodValidator } from "../utils/validation.js";

import type { AppBindings } from "../lib/types.js";

/**
 * Wallet-signed token moderation endpoints (issue #586).
 *
 * Distinct from the `X-Admin-Key`-gated `/api/v1/admin/*` routes:
 * those are intended for ops scripts running with a shared secret;
 * these are intended for the front-end UI where a connected wallet
 * proves ownership via an EIP-191 signature.
 *
 * Auth model: reuses the same 24-hour session-signature flow as
 * `profiles.ts` and `useSessionSignature` on the web. The admin signs
 * `buildSessionMessage(address, expiresAt)` once per day; the resulting
 * signature is persisted in localStorage and replayed on every
 * moderation action. Server verifies the signature recovers to the
 * claimed address and that the address sits inside the admin allowlist
 * (`ADMIN_WALLETS` env, falling back to `DEFAULT_ADMIN_WALLETS` from
 * `@launchpad/shared`).
 *
 * Replay window is bounded by `expiresAt` and capped server-side at
 * `SESSION_DURATION_MS + clock skew` so a malicious client can't sign
 * a multi-year-valid moderation message.
 */
const moderationRoute = new Hono<{ Bindings: AppBindings }>();

const MAX_SIGNATURE_CLOCK_SKEW_MS = 60_000;

const signedActionSchema = z.object({
  /** Admin wallet address. Verified to match the recovered signer. */
  address: z.string().min(1, "Address is required"),
  /** Hex-encoded EIP-191 signature of the canonical session message. */
  signature: z.string().min(1, "Signature is required"),
  /** Unix-ms expiry baked into the signed message. */
  expiresAt: z.number().finite("Invalid expiresAt"),
});

/**
 * Public endpoint: returns whether a given wallet is allowed to perform
 * moderation actions. The frontend uses this to decide whether to render
 * the admin button on the token detail page. Intentionally returns the
 * boolean only — never the full allowlist — so probing an address tells
 * a caller about that one wallet but doesn't enumerate the admin set.
 */
moderationRoute.get("/admins/:address", (c) => {
  const rawAddress = c.req.param("address");
  if (!isAddress(rawAddress)) {
    return c.json(formatError("Invalid address"), 400);
  }
  const address = getAddress(rawAddress);
  const isAdmin = isAdminFor(c.env, address);
  return c.json(formatSuccess({ address, isAdmin }));
});

interface VerifiedAdmin {
  /** Resolved checksum admin wallet address. */
  admin: string;
}

type VerifyResult =
  | { ok: true; data: VerifiedAdmin }
  | { ok: false; status: 400 | 401; error: string };

async function verifyAdminSession(args: {
  env: AppBindings;
  rawAddress: string;
  signature: string;
  expiresAt: number;
}): Promise<VerifyResult> {
  if (!isAddress(args.rawAddress)) {
    return { ok: false, status: 400, error: "Invalid address" };
  }
  const claimed = getAddress(args.rawAddress);

  const now = Date.now();
  if (now >= args.expiresAt) {
    return { ok: false, status: 401, error: "Session signature has expired" };
  }
  // Mirrors `profiles.ts` — without an upper bound a malicious client could
  // sign a multi-year-valid session message and replay it indefinitely.
  if (args.expiresAt > now + SESSION_DURATION_MS + MAX_SIGNATURE_CLOCK_SKEW_MS) {
    return {
      ok: false,
      status: 401,
      error: "Session signature lifetime exceeds maximum",
    };
  }

  const message = buildSessionMessage(claimed, args.expiresAt);

  let recovered: string;
  try {
    recovered = await recoverMessageAddress({
      message,
      signature: args.signature as `0x${string}`,
    });
  } catch {
    return { ok: false, status: 401, error: "Invalid signature" };
  }

  if (getAddress(recovered) !== claimed) {
    return { ok: false, status: 401, error: "Signature does not match address" };
  }

  if (!isAdminFor(args.env, claimed)) {
    // Generic 401 — don't disambiguate "not an admin" from "bad signature"
    // so a probe can't enumerate the allowlist via timing or error text.
    // Legitimate "am I admin?" callers use /moderation/admins/:address.
    return { ok: false, status: 401, error: "Not authorised" };
  }

  return { ok: true, data: { admin: claimed } };
}

async function setHidden(args: {
  env: AppBindings;
  tokenAddress: string;
  isHidden: boolean;
  body: z.infer<typeof signedActionSchema>;
}) {
  const tokenAddressRaw = args.tokenAddress;
  if (!isAddress(tokenAddressRaw)) {
    return { kind: "error" as const, status: 400 as const, error: "Invalid address" };
  }
  const token = getAddress(tokenAddressRaw);

  const verified = await verifyAdminSession({
    env: args.env,
    rawAddress: args.body.address,
    signature: args.body.signature,
    expiresAt: args.body.expiresAt,
  });
  if (!verified.ok) {
    return { kind: "error" as const, status: verified.status, error: verified.error };
  }

  const db = createDb(args.env.HYPERDRIVE.connectionString);
  const [updated] = await db
    .update(tokens)
    .set({ isHidden: args.isHidden })
    .where(eq(tokens.address, token))
    .returning({ address: tokens.address, isHidden: tokens.isHidden });

  if (!updated) {
    return { kind: "error" as const, status: 404 as const, error: "Token not found" };
  }

  return {
    kind: "ok" as const,
    data: {
      address: updated.address,
      isHidden: updated.isHidden,
      admin: verified.data.admin,
    },
  };
}

moderationRoute.post(
  "/tokens/:address/hide",
  zodValidator("json", signedActionSchema),
  async (c) => {
    const result = await setHidden({
      env: c.env,
      tokenAddress: c.req.param("address"),
      isHidden: true,
      body: c.req.valid("json"),
    });
    if (result.kind === "error") {
      return c.json(formatError(result.error), result.status);
    }
    return c.json(formatSuccess(result.data));
  },
);

moderationRoute.post(
  "/tokens/:address/unhide",
  zodValidator("json", signedActionSchema),
  async (c) => {
    const result = await setHidden({
      env: c.env,
      tokenAddress: c.req.param("address"),
      isHidden: false,
      body: c.req.valid("json"),
    });
    if (result.kind === "error") {
      return c.json(formatError(result.error), result.status);
    }
    return c.json(formatSuccess(result.data));
  },
);

// Re-exported so call sites in tests / other routes can ask "is this
// caller currently configured as an admin?" without repeating the env
// plumbing. Avoids a second source of truth for the lookup logic.
export { getAdminWallets, isAdminFor };

export default moderationRoute;
