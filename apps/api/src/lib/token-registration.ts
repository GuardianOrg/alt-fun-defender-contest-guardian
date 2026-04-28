/**
 * Off-chain registration of a token that has already been launched on-chain.
 *
 * Why this exists: the home-page token list reads from PostgreSQL (not the
 * indexer) for query-shape and pagination reasons. After `Zap.createToken`
 * lands, we still need a row in `tokens` for the new token to appear in the
 * UI. The previous design required the creator to sign an off-chain message
 * embedding all the metadata — a second wallet popup right after the launch
 * tx, which was the dominant create-flow friction point.
 *
 * The new design treats on-chain `Bonding.TokenInfo` as the source of truth.
 * Anyone can call `POST /api/v1/tokens { address }` — the API reads
 * `getTokenInfo` directly, validates that the image URL points at our R2
 * bucket (so the moderation pipeline can't be bypassed), looks up the LT to
 * derive `underlying` / `leverage` / `direction`, and inserts the row. No
 * signature: a stranger calling this for someone else's launch produces the
 * same row the creator's call would have produced, so there's nothing to
 * spoof.
 *
 * The frontend awaits this synchronously after the tx confirms, so the user
 * sees a spinner until their token is queryable. As a safety net the API
 * Worker's cron handler (`registration-backfill.ts`) sweeps any
 * `Bonding.TokenLaunched` events that haven't been registered yet —
 * recovers from a closed tab, lost network, or transient API error without
 * the creator having to do anything.
 */

import { eq } from "drizzle-orm";
import { createPublicClient, getAddress, http, isAddress } from "viem";

import {
  BondingAbi,
  BOUNCE_INDEXING_API,
  CONTRACT_ADDRESSES,
  filterSupportedLTs,
  HYPER_EVM,
  type LiveLeveragedToken,
} from "@launchpad/shared";

import { createDb } from "../db/client.js";
import { tokens } from "../db/schema.js";
import { broadcastToChannel } from "./broadcast.js";

import type { AppBindings } from "./types.js";

const chain = {
  id: HYPER_EVM.id,
  name: HYPER_EVM.name,
  nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
  rpcUrls: { default: { http: [HYPER_EVM.rpcUrl] } },
} as const;

/// Worker-isolate cache for the BounceTech LT directory. We resolve LT
/// addresses → `underlying` / `leverage` / `direction` from the public list,
/// which changes infrequently. 60s is plenty short to pick up newly listed
/// LTs without hammering BounceTech.
const LT_CACHE_TTL_MS = 60_000;
let cachedLTs: { data: LiveLeveragedToken[]; ts: number } | null = null;

/**
 * R2 keys produced by `POST /api/v1/images` are always under the
 * `tokens/` prefix. Validating image URLs against this prefix (plus a
 * positive R2 HEAD) is what enforces "every image rendered in the UI
 * came through our moderation pipeline". A bypassed launch with an
 * arbitrary URL is rejected — see `RegistrationError.code = "image_invalid"`.
 */
const IMAGE_KEY_PREFIX = "tokens/";
const IMAGE_PATH_PREFIX = "/images/tokens/";

export type RegistrationErrorCode =
  | "invalid_address"
  | "not_launched"
  | "image_invalid"
  | "lt_unknown"
  | "rpc_error"
  | "db_error";

export class RegistrationError extends Error {
  readonly code: RegistrationErrorCode;
  readonly status: number;

  constructor(code: RegistrationErrorCode, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

interface OnChainTokenInfo {
  creator: `0x${string}`;
  token: `0x${string}`;
  pair: `0x${string}`;
  ltAddress: `0x${string}`;
  name: string;
  ticker: string;
  description: string;
  image: string;
  urls: readonly [string, string, string, string];
}

export interface RegisteredToken {
  address: string;
  name: string;
  ticker: string;
  description: string;
  imageUrl: string;
  ltPair: string;
  ltDirection: "long" | "short";
  leverage: number;
  underlying: string;
  status: string;
  graduatedAt: Date | null;
  poolAddress: string | null;
  twitterUrl: string;
  telegramUrl: string;
  websiteUrl: string;
  creator: string;
  isHidden: boolean;
  createdAt: Date;
}

/**
 * Register a token in PostgreSQL by reading its launch metadata directly
 * from `Bonding.getTokenInfo`. Idempotent — `ON CONFLICT DO NOTHING` on the
 * primary key, so concurrent calls (or a frontend retry on top of the
 * cron backfill) collapse to a single insert.
 *
 * Returns:
 *   - `{ kind: "registered", token }` on a successful insert
 *   - `{ kind: "exists", token }` when the row was already present
 *
 * Throws `RegistrationError` on every other failure so callers can map
 * the codes to HTTP statuses.
 */
export async function registerTokenFromChain(
  env: AppBindings,
  rawAddress: string,
  apiOrigin?: string,
): Promise<
  | { kind: "registered"; token: RegisteredToken }
  | { kind: "exists"; token: RegisteredToken }
> {
  if (!isAddress(rawAddress)) {
    throw new RegistrationError("invalid_address", "Invalid address", 400);
  }
  const address = getAddress(rawAddress);

  const db = createDb(env.DATABASE_URL);

  // Fast-path: row already exists. Avoids RPC + R2 + BounceTech round-trips
  // on the hot path (frontend awaits this and the cron sweep races it).
  const existing = await db
    .select()
    .from(tokens)
    .where(eq(tokens.address, address))
    .limit(1);
  if (existing.length > 0) {
    return { kind: "exists", token: existing[0] as RegisteredToken };
  }

  const info = await fetchOnChainInfo(env, address);
  const imageUrl = await validateImageUrl(env, info.image, apiOrigin);
  const ltMeta = await resolveLtMeta(info.ltAddress);

  const inserted = await db
    .insert(tokens)
    .values({
      address,
      name: info.name,
      ticker: info.ticker,
      description: info.description,
      imageUrl,
      ltPair: getAddress(info.ltAddress),
      ltDirection: ltMeta.isLong ? "long" : "short",
      leverage: ltMeta.targetLeverage,
      underlying: ltMeta.targetAsset,
      // `urls[0..2]` mirrors the order the frontend wrote on-chain (twitter,
      // telegram, website). `urls[3]` is reserved.
      twitterUrl: info.urls[0] ?? "",
      telegramUrl: info.urls[1] ?? "",
      websiteUrl: info.urls[2] ?? "",
      creator: getAddress(info.creator),
    })
    .onConflictDoNothing()
    .returning();

  if (inserted.length === 0) {
    // Lost the race to another caller (frontend vs. cron, or two cron
    // ticks). Re-read so we can return the canonical row.
    const reread = await db
      .select()
      .from(tokens)
      .where(eq(tokens.address, address))
      .limit(1);
    if (reread.length === 0) {
      throw new RegistrationError("db_error", "Token registration failed", 500);
    }
    return { kind: "exists", token: reread[0] as RegisteredToken };
  }

  const token = inserted[0] as RegisteredToken;

  // Same fire-and-forget pattern as the old route. `waitUntil` keeps the
  // Worker alive past the response so a slow DO fetch doesn't block the
  // user's spinner. Caller (`route` or `cron`) provides the execution ctx.
  return { kind: "registered", token };
}

/**
 * Convenience wrapper used by both the route handler and the cron backfill
 * to broadcast the `newToken` event after a fresh insert. Separated so the
 * caller chooses how to attach it to `executionCtx.waitUntil`.
 */
export function broadcastNewToken(
  env: AppBindings,
  token: RegisteredToken,
): Promise<void> {
  return broadcastToChannel(env, "newToken", token).catch(() => {});
}

// ─── Internals ────────────────────────────────────────────────────────────

async function fetchOnChainInfo(
  env: AppBindings,
  address: `0x${string}`,
): Promise<OnChainTokenInfo> {
  const transport = http(env.HYPEREVM_RPC_URL || HYPER_EVM.rpcUrl);
  const client = createPublicClient({ chain, transport });

  let info: OnChainTokenInfo;
  try {
    const raw = (await client.readContract({
      address: CONTRACT_ADDRESSES.bonding as `0x${string}`,
      abi: BondingAbi,
      functionName: "getTokenInfo",
      args: [address],
    })) as OnChainTokenInfo & { lifecycle?: number };
    info = raw;
  } catch (err) {
    throw new RegistrationError(
      "rpc_error",
      `Failed to read token info: ${err instanceof Error ? err.message : "unknown"}`,
      502,
    );
  }

  // `getTokenInfo` returns a zero-filled struct for an unregistered token
  // (mapping miss returns the type's default). `info.token == 0x00…` is
  // the cheapest existence check.
  if (
    info.token === "0x0000000000000000000000000000000000000000" ||
    info.creator === "0x0000000000000000000000000000000000000000"
  ) {
    throw new RegistrationError("not_launched", "Token not found on-chain", 404);
  }

  return info;
}

/**
 * Strict R2-only image validation. The image URL must:
 *   1. Parse as a URL.
 *   2. Have a path under `/images/tokens/` — the prefix `POST /api/v1/images`
 *      writes to.
 *   3. Resolve to an object that actually exists in our R2 bucket.
 *
 * After the R2 HEAD succeeds the URL is **canonicalized** to `apiOrigin`
 * (when supplied). The route handler always supplies its request origin,
 * so the legitimate frontend → API path always stores a URL on our own
 * domain — defending against an on-chain bypass where someone calls
 * `Zap.createToken` directly with `https://attacker.com/images/tokens/<key>`
 * and a key that happens to exist in our R2.
 *
 * The cron backfill does NOT supply `apiOrigin` today (we don't have a
 * stable canonical hostname yet — we're on a `*.workers.dev` URL that's
 * about to move to a custom domain). For the tokens it picks up, it
 * stores the validated raw URL. The residual risk is narrow: it requires
 * an attacker to (a) bypass our frontend, (b) know a valid R2 key, and
 * (c) avoid calling the register endpoint themselves so only the cron
 * processes the token. Once we have a stable hostname this becomes a
 * one-line fix: import `API_PUBLIC_ORIGIN` from `@launchpad/shared` and
 * pass it to `registerTokenFromChain` from the cron caller.
 *
 * Empty image is allowed (creator chose not to upload one). Any URL that
 * fails the checks results in a `RegistrationError` — we don't quietly
 * strip-and-store, because doing so would conceal a contract-level
 * moderation bypass.
 */
async function validateImageUrl(
  env: AppBindings,
  raw: string,
  apiOrigin: string | undefined,
): Promise<string> {
  if (raw === "") return "";

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new RegistrationError("image_invalid", "Image URL is not a valid URL", 422);
  }

  if (!url.pathname.startsWith(IMAGE_PATH_PREFIX)) {
    throw new RegistrationError(
      "image_invalid",
      "Image URL must point to the Alt Fun image bucket",
      422,
    );
  }

  // R2 key is everything after `/images/`.
  const key = url.pathname.slice("/images/".length);
  if (!key.startsWith(IMAGE_KEY_PREFIX) || key.length === IMAGE_KEY_PREFIX.length) {
    throw new RegistrationError("image_invalid", "Image URL is malformed", 422);
  }

  const head = await env.IMAGES_BUCKET.head(key);
  if (head === null) {
    throw new RegistrationError(
      "image_invalid",
      "Image not found in storage — re-upload via /api/v1/images",
      422,
    );
  }

  // Canonicalize: replace whatever origin the caller stamped with ours so
  // the DB always stores a URL we control. If `apiOrigin` is unavailable
  // (cron without IMAGES_PUBLIC_URL configured), fall back to the raw URL —
  // still verified to be a key in our bucket, just not origin-enforced.
  return apiOrigin ? `${apiOrigin}/images/${key}` : raw;
}

async function resolveLtMeta(
  ltAddress: `0x${string}`,
): Promise<LiveLeveragedToken> {
  const lts = await fetchLiveLts();
  const target = ltAddress.toLowerCase();
  const match = lts.find((lt) => lt.address.toLowerCase() === target);
  if (!match) {
    throw new RegistrationError(
      "lt_unknown",
      "LT address is not in the BounceTech directory",
      422,
    );
  }
  return match;
}

async function fetchLiveLts(): Promise<LiveLeveragedToken[]> {
  if (cachedLTs && Date.now() - cachedLTs.ts < LT_CACHE_TTL_MS) {
    return cachedLTs.data;
  }
  try {
    const res = await fetch(`${BOUNCE_INDEXING_API}/leveraged-tokens`);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const json = (await res.json()) as { data?: LiveLeveragedToken[] };
    const lts = filterSupportedLTs(json.data ?? []);
    cachedLTs = { data: lts, ts: Date.now() };
    return lts;
  } catch (err) {
    if (cachedLTs) return cachedLTs.data;
    throw new RegistrationError(
      "lt_unknown",
      `BounceTech LT directory unavailable: ${err instanceof Error ? err.message : "unknown"}`,
      502,
    );
  }
}
