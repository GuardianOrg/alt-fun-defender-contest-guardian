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
  CONTRACT_ADDRESSES,
  HYPER_EVM,
  sanitizeTelegramHandle,
  sanitizeTwitterHandle,
  sanitizeWebsiteUrl,
  type LiveLeveragedToken,
} from "@launchpad/shared";

import { createDb } from "../db/client.js";
import { tokens } from "../db/schema.js";
import { broadcastToChannel } from "./broadcast.js";
import { readLtByAddress } from "./lt-directory-reads.js";

import type { AppBindings } from "./types.js";

const chain = {
  id: HYPER_EVM.id,
  name: HYPER_EVM.name,
  nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
  rpcUrls: { default: { http: [HYPER_EVM.rpcUrl] } },
} as const;


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

  constructor(
    code: RegistrationErrorCode,
    message: string,
    status: number,
    options?: { cause?: unknown },
  ) {
    // Pass `cause` through to `Error` so `describeError` in
    // `registration-backfill.ts` can walk to the root Postgres error and
    // surface its `message` / `code` in the cron logs. Without this, a
    // wrapped `db_error` would hide the underlying "value too long for
    // type character varying(N)" / unique-constraint detail behind a
    // generic "Token registration failed" string — defeating the whole
    // point of classifying DB failures separately.
    super(message, options);
    this.code = code;
    this.status = status;
  }
}

/** Public message returned to clients for any `db_error`. Deliberately
 * generic so we don't leak Postgres column shapes / constraint names /
 * SQL fragments in API responses (see `.cursor/rules/api.mdc` —
 * "Never expose internal error details to clients"). The full Postgres
 * detail is preserved on `RegistrationError.cause` and emitted in a
 * structured Worker log line — see `withDbError` below. */
const DB_ERROR_PUBLIC_MESSAGE = "Token registration failed" as const;

/**
 * Run a Drizzle DB operation and convert any thrown error into a
 * `RegistrationError("db_error", …, 500, { cause })`.
 *
 * Why: Drizzle raises `DrizzleQueryError` for every Postgres-side failure
 * (`value too long for type character varying(N)`, unique-constraint
 * violations, connection drops, etc.). Without this wrapper those bubble
 * up un-classified — the synchronous `POST /api/v1/tokens` route only
 * catches `RegistrationError`, so the request 500s with a generic
 * "Internal Server Error" body, and the cron backfill's `describeError`
 * logs the failure under `code: "unknown"` instead of `db_error`. That's
 * how the BRENTOIL `underlying varchar(10)` overflow shipped silently
 * for days: a schema column was narrower than the data we were trying
 * to insert, but the only signal was an uncategorised 500.
 *
 * Wrapping it here keeps the failure mode legible end-to-end:
 *   - Operators see the actual Postgres detail in the **structured
 *     Worker log** emitted below (`event: "registration_db_error"`,
 *     `rootError: <pg message>`, `errorCode: <SQLSTATE>`), which
 *     surfaces in Cloudflare logs / wrangler tail without leaking
 *     anything to API clients.
 *   - The cron backfill's `describeError` walks the `cause` chain we
 *     attach here, so its `registration_backfill_skip` log line also
 *     carries the root message (`code: "db_error"` instead of
 *     `code: "unknown"`).
 *   - API clients get a stable, generic `DB_ERROR_PUBLIC_MESSAGE` —
 *     enough for the frontend's `setWarning(...)` to say "indexing is
 *     delayed, try again", with the actionable diagnostic only on the
 *     operator side.
 *
 * Use this for every Drizzle call inside `registerTokenFromChain`; the
 * cost is one extra try/catch frame per query, which is irrelevant
 * compared to the round-trip latency.
 */
async function withDbError<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (err) {
    // Walk the `cause` chain to find the actual Postgres error. Drizzle
    // wraps every query failure in a `DrizzleQueryError` whose `.message`
    // is `"Failed query: <sql>"`. The root error carries the useful
    // detail, e.g. `value too long for type character varying(10)` or
    // `duplicate key value violates unique constraint "tokens_pkey"`.
    // Mirrors the same walk `describeError` does in
    // `registration-backfill.ts`.
    let root: unknown = err;
    while (root instanceof Error && root.cause !== undefined && root.cause !== root) {
      root = root.cause;
    }
    const rootMessage = root instanceof Error ? root.message : String(root);
    const rootCode = root instanceof Error
      ? ((root as Error & { code?: unknown }).code)
      : undefined;

    // Operator-side signal: structured log line so Cloudflare logs /
    // wrangler tail carry the root Postgres message and SQLSTATE on
    // every `db_error`. The synchronous route handler doesn't run
    // through `app.onError` (it catches `RegistrationError` and
    // returns the generic public string), so without this the only
    // place this detail would ever surface is the cron's
    // `registration_backfill_skip` line — useless for diagnosing a
    // user-driven `POST /api/v1/tokens` failure.
    console.log(
      JSON.stringify({
        level: "error",
        event: "registration_db_error",
        rootError: rootMessage,
        ...(typeof rootCode === "string" ? { errorCode: rootCode } : {}),
        timestamp: new Date().toISOString(),
      }),
    );

    throw new RegistrationError(
      "db_error",
      DB_ERROR_PUBLIC_MESSAGE,
      500,
      { cause: err },
    );
  }
}

interface OnChainTokenInfo {
  creator: `0x${string}`;
  pair: `0x${string}`;
  ltAddress: `0x${string}`;
  name: string;
  ticker: string;
  description: string;
  image: string;
  urls: readonly [string, string, string];
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
  //
  // `withDbError` wraps any thrown `DrizzleQueryError` into a
  // `RegistrationError("db_error", …)` so the cron logs and the route's
  // error envelope keep DB failures categorised — see the helper's
  // docstring for the full rationale.
  const existing = await withDbError(() =>
    db
      .select()
      .from(tokens)
      .where(eq(tokens.address, address))
      .limit(1),
  );
  if (existing.length > 0) {
    return { kind: "exists", token: existing[0] as RegisteredToken };
  }

  const info = await fetchOnChainInfo(env, address);
  const imageUrl = await validateImageUrl(env, info.image, apiOrigin);
  const ltMeta = await resolveLtMeta(env.DATABASE_URL, info.ltAddress);

  const inserted = await withDbError(() =>
    db
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
        // telegram, website). Each value is sanitized before storage — see
        // issue #400. Twitter/Telegram collapse to a bare handle (so the
        // frontend can build the link via the canonical
        // `https://x.com/<handle>` / `https://t.me/<path>` template), and
        // website is canonicalised to a parseable http(s) URL. Anything that
        // can't be reduced to a safe value collapses to "" — the on-chain
        // bytes survive on `Bonding.TokenInfo` but they never reach an
        // `<a href>`.
        twitterUrl: sanitizeTwitterHandle(info.urls[0] ?? ""),
        telegramUrl: sanitizeTelegramHandle(info.urls[1] ?? ""),
        websiteUrl: sanitizeWebsiteUrl(info.urls[2] ?? ""),
        creator: getAddress(info.creator),
      })
      .onConflictDoNothing()
      .returning(),
  );

  if (inserted.length === 0) {
    // Lost the race to another caller (frontend vs. cron, or two cron
    // ticks). Re-read so we can return the canonical row.
    const reread = await withDbError(() =>
      db
        .select()
        .from(tokens)
        .where(eq(tokens.address, address))
        .limit(1),
    );
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
  // (mapping miss returns the type's default). `info.creator == 0x00…` is
  // the cheapest existence check.
  if (info.creator === "0x0000000000000000000000000000000000000000") {
    throw new RegistrationError("not_launched", "Token not found on-chain", 404);
  }

  return info;
}

/**
 * Strict R2-only image validation. The image URL must:
 *   1. Be either an absolute URL or a root-relative path.
 *   2. Have a path under `/images/tokens/` — the prefix `POST /api/v1/images`
 *      writes to.
 *   3. Resolve to an object that actually exists in our R2 bucket.
 *
 * After the R2 HEAD succeeds we **strip** any caller-supplied origin and
 * store the bare path `/images/tokens/<key>`. Storing relative defends
 * against the bypass where someone calls `Zap.createToken` directly with
 * `https://attacker.com/images/tokens/<valid-key>` (the attacker's host
 * never reaches the DB) and — more commonly — keeps tokens created
 * against a non-production API origin (e.g. `http://localhost:8787`)
 * loadable on every other environment that reads the same row.
 * Frontends resolve the relative URL against their own `API_BASE`, so a
 * single stored path renders correctly in dev, preview, and production
 * without an env-specific canonical hostname.
 *
 * Both absolute URLs (legacy uploads + on-chain bypass attempts) and
 * relative paths (new uploads, post-#450) are accepted on input —
 * only the stored form is normalized.
 *
 * Empty image is allowed (creator chose not to upload one). Any URL that
 * fails the checks results in a `RegistrationError` — we don't quietly
 * strip-and-store, because doing so would conceal a contract-level
 * moderation bypass.
 *
 * `apiOrigin` is unused today; kept on the signature so the route and
 * cron callers can keep passing their request origin without churning
 * call sites if we ever need it again.
 */
async function validateImageUrl(
  env: AppBindings,
  raw: string,
  _apiOrigin: string | undefined,
): Promise<string> {
  if (raw === "") return "";

  // Accept both absolute URLs and root-relative paths. Anything else
  // (protocol-relative, query-only, fragment-only, bare strings) falls
  // through to the URL parser and is rejected uniformly.
  let pathname: string;
  if (raw.startsWith("/")) {
    pathname = raw;
  } else {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new RegistrationError("image_invalid", "Image URL is not a valid URL", 422);
    }
    pathname = url.pathname;
  }

  if (!pathname.startsWith(IMAGE_PATH_PREFIX)) {
    throw new RegistrationError(
      "image_invalid",
      "Image URL must point to the Alt Fun image bucket",
      422,
    );
  }

  // R2 key is everything after `/images/`.
  const key = pathname.slice("/images/".length);
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

  return `/images/${key}`;
}

async function resolveLtMeta(
  databaseUrl: string,
  ltAddress: `0x${string}`,
): Promise<LiveLeveragedToken> {
  // `readLtByAddress` distinguishes "not present" (returns null) from
  // "DB read failed" (returns undefined). We map the two to different
  // `RegistrationError` codes so the cron and frontend retry the second
  // (transient) but surface the first as a permanent 422 to the caller.
  const match = await readLtByAddress(databaseUrl, ltAddress);
  if (match === undefined) {
    throw new RegistrationError(
      "rpc_error",
      "LT directory mirror unavailable",
      502,
    );
  }
  if (match === null) {
    throw new RegistrationError(
      "lt_unknown",
      "LT address is not in the BounceTech directory",
      422,
    );
  }
  return match;
}
