import { Hono } from "hono";
import { logger } from "hono/logger";
import { prettyJSON } from "hono/pretty-json";
import { swaggerUI } from "@hono/swagger-ui";

import formatSuccess from "./utils/format-success.js";
import formatError from "./utils/format-error.js";
import { checkPonderHealth } from "./lib/ponder-client.js";
import { runGraduationKeeper } from "./lib/graduation-keeper.js";
import { runRegistrationBackfill } from "./lib/registration-backfill.js";
import { runModerationLogsCleanup } from "./lib/moderation-logs-cleanup.js";
import tokens from "./routes/tokens/index.js";
import trades from "./routes/trades.js";
import creators from "./routes/creators.js";
import admin from "./routes/admin/index.js";
import { imagesPublic, imagesPrivate } from "./routes/images.js";
import balancesRoute from "./routes/balances.js";
import portfolio from "./routes/portfolio.js";
import stats from "./routes/stats.js";
import assets from "./routes/assets.js";
import referrals from "./routes/referrals.js";
import holders from "./routes/holders.js";
import security from "./routes/security.js";
import profiles from "./routes/profiles.js";
import chart from "./routes/chart.js";
import marketData from "./routes/market-data.js";
import { apiKeyAuth } from "./middleware/api-key-auth.js";
import { corsMiddleware } from "./middleware/cors.js";
import { serveFromEdgeCache } from "./middleware/edge-cache.js";
import openApiSpec from "./openapi/spec.js";
import { validateWebhookPayload } from "./lib/webhook-validators.js";

import type { AppBindings } from "./lib/types.js";

import { WebSocketDO, shardKeyFor } from "./websocket/durable-object.js";
import {
  WsIpLimiter,
  tryAcquireIpSlot,
  releaseIpSlot,
} from "./websocket/ip-limiter.js";

/**
 * Whitelisted WS channel names. Anything else is rejected with 400 *before*
 * we burn an IP-limiter slot — a typo like `?channel=trdae` should fail
 * fast and not consume one of the caller's 10 global connection slots or
 * spawn a never-fanned-out shard DO.
 */
const VALID_WS_CHANNELS: ReadonlySet<string> = new Set([
  "trade",
  "price",
  "graduation",
  "newToken",
  "stats",
]);

export { WebSocketDO, WsIpLimiter };
export { LtTicker } from "./websocket/lt-ticker.js";

const app = new Hono<{ Bindings: AppBindings }>();

app.use("*", logger());
app.use("*", corsMiddleware);
app.use("*", prettyJSON());

/**
 * Once per Worker isolate, touch the LtTicker DO so its constructor runs and
 * self-kickstarts its alarm loop. In prod this is redundant with the cron
 * trigger, but in local dev `wrangler dev` doesn't fire crons, and without
 * this the ticker would stay dormant until someone hit the admin endpoint
 * manually. Cost is a single DO fetch per cold start.
 */
let ltTickerTouched = false;
app.use("*", async (c, next) => {
  if (!ltTickerTouched) {
    ltTickerTouched = true;
    const id = c.env.LT_TICKER_DO.idFromName("lt-ticker");
    const stub = c.env.LT_TICKER_DO.get(id);
    c.executionCtx.waitUntil(
      stub.fetch("https://internal/ensure").catch(() => {
        ltTickerTouched = false;
      }),
    );
  }
  await next();
});

app.get("/", (c) => c.json(formatSuccess("Alt Fun API")));
app.get("/health", async (c) => {
  const ponderHealthy = await checkPonderHealth(c.env.PONDER_URL);
  return c.json(formatSuccess({
    status: ponderHealthy ? "healthy" : "degraded",
    services: {
      api: true,
      ponder: ponderHealthy,
    },
  }));
});

app.get("/api/docs/openapi.json", (c) => c.json(openApiSpec));
app.get(
  "/api/docs",
  swaggerUI({ url: "/api/docs/openapi.json" }),
);

// Pre-auth edge-cache lookup. Must run *before* `apiKeyAuth` so a hit
// returns the cached payload without debiting the per-IP rate-limit
// window. The 60 req/min anon ceiling was originally tuned for one
// browser per public IP; in practice 6+ users share an office or
// venue WiFi and collectively blew through it within seconds, even
// though every request after the first cache fill is identical. The
// route handlers still do `caches.default.put()` and own the TTL
// policy — this middleware only reads. See issue #549 and
// `middleware/edge-cache.ts` for the rationale in full.
app.use("/api/v1/*", serveFromEdgeCache);
app.use("/api/v1/*", apiKeyAuth);

app.route("/api/v1/tokens", tokens);
app.route("/api/v1/trades", trades);
app.route("/api/v1/creators", creators);
app.route("/api/v1/admin", admin);
// Two separate mounts: the bare `/images` prefix is public (GET-only)
// so on-chain `LaunchParams.image` URLs (`/images/{prefix}/{key}`, issue
// #450) resolve without authentication, while `POST /images` (which is
// expensive — OpenAI moderation call + R2 PUT + Neon insert) lives only
// behind `apiKeyAuth` at `/api/v1/images`. A single dual-mounted router
// would re-expose `POST /images` with no auth and no rate limit (issue
// #509).
app.route("/api/v1/images", imagesPrivate);
app.route("/images", imagesPublic);
app.route("/api/v1/balances", balancesRoute);
app.route("/api/v1/portfolio", portfolio);
app.route("/api/v1/stats", stats);
app.route("/api/v1/assets", assets);
app.route("/api/v1/referrals", referrals);
app.route("/api/v1/holders", holders);
app.route("/api/v1/security", security);
app.route("/api/v1/profiles", profiles);
app.route("/api/v1/chart", chart);
app.route("/api/v1/market-data", marketData);

app.post("/api/v1/webhook/indexer", async (c) => {
  const adminKey = c.req.header("X-Admin-Key");
  if (!adminKey || adminKey !== c.env.ADMIN_API_KEY) {
    return c.json(formatError("Unauthorized"), 401);
  }

  // Parse defensively — a malformed JSON body must surface as 400, not as a
  // 500 from the unhandled SyntaxError.
  let body: { event?: unknown; data?: unknown; tokenAddress?: unknown };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json(formatError("Invalid JSON body"), 400);
  }

  if (typeof body.event !== "string") {
    return c.json(formatError("Missing or invalid `event`"), 400);
  }

  // Validate per-channel envelope before fan-out. The indexer is a separate
  // trust boundary (and the admin key only gates *who* can broadcast, not
  // *what* shape) — without this, a bug or compromised key delivers
  // malformed payloads to every connected client. See issue #403.
  const validationError = validateWebhookPayload(
    body.event,
    body.data,
    body.tokenAddress,
  );
  if (validationError !== null) {
    return c.json(formatError(validationError), 400);
  }

  const { broadcastToChannel } = await import("./lib/broadcast.js");
  await broadcastToChannel(
    c.env,
    body.event,
    body.data,
    body.tokenAddress as string | undefined,
  );

  return c.json(formatSuccess({ broadcasted: true }));
});

/**
 * WebSocket upgrade endpoint. Sharded by `(channel, token?)` — each
 * connection lives on a single subject shard so broadcasts only fan out to
 * the connections that opted in. See `websocket/durable-object.ts` for the
 * shard-routing rationale (issue #395).
 *
 * Required query params:
 *   - `channel`  — one of `trade`, `price`, `graduation`, `newToken`, `stats`.
 *   - `token`    — optional, lowercased token / LT address. Per-token
 *                  channels with no `token` join the wildcard shard and
 *                  receive every event on the channel.
 *
 * Public, anonymous endpoint — the frontend doesn't authenticate and
 * neither does this. Abuse is bounded by the dedicated `WsIpLimiter` DO
 * (per-IP connection cap, enforced before the upgrade) and subject
 * sharding (one connection sees one shard's events). See issue #401.
 */
app.get("/ws", async (c) => {
  const upgradeHeader = c.req.header("Upgrade");
  if (upgradeHeader?.toLowerCase() !== "websocket") {
    return c.json(formatError("Expected WebSocket upgrade"), 426);
  }

  const reqUrl = new URL(c.req.url);
  const channel = reqUrl.searchParams.get("channel");
  const token = reqUrl.searchParams.get("token");
  if (!channel) {
    return c.json(
      formatError("Missing required query param `channel`"),
      400,
    );
  }
  if (!VALID_WS_CHANNELS.has(channel)) {
    // Reject *before* acquiring an IP slot — a typo'd channel must not
    // burn one of the caller's 10 global slots or spawn a dead shard.
    return c.json(formatError(`Unsupported channel: ${channel}`), 400);
  }

  const clientIp =
    c.req.header("CF-Connecting-IP") ??
    c.req.header("X-Forwarded-For") ??
    "unknown";

  // Per-IP global cap. Reject before the upgrade so the ws handshake never
  // succeeds for a rate-limited IP — crucial because the upgrade itself is
  // the resource we're trying to bound.
  const slot = await tryAcquireIpSlot(c.env.WS_IP_LIMITER_DO, clientIp);
  if (!slot.ok) {
    return c.json(formatError("Too many connections from this IP"), 429);
  }

  // Once the slot is acquired we must release it on every failure path
  // *before* the WS is accepted by the shard DO. After a successful
  // 101-Upgrade, the slot is released by the shard DO's `webSocketClose`
  // handler. Any other branch (DO throw, non-101 response from validation
  // or auth failure inside the DO) would otherwise leak limiter capacity
  // until the IP eventually gets stuck at 429.
  const releaseOnFailure = () =>
    releaseIpSlot(c.env.WS_IP_LIMITER_DO, clientIp).catch(() => {
      // Best effort — a stuck limiter just leaks the slot until its
      // idle TTL sweep. Worse to throw and crash the request.
    });

  try {
    const shardKey = shardKeyFor(channel, token);
    const id = c.env.WEBSOCKET_DO.idFromName(shardKey);
    const stub = c.env.WEBSOCKET_DO.get(id);

    const headers = new Headers(c.req.raw.headers);
    headers.set("X-Client-IP", clientIp);

    // Stamp the shard key on the URL so the DO knows its own subject
    // (used for log context — `idFromName` is one-way).
    const doUrl = new URL(c.req.raw.url);
    doUrl.searchParams.set("shard", shardKey);

    const doRequest = new Request(doUrl.toString(), {
      method: c.req.raw.method,
      headers,
    });

    const response = await stub.fetch(doRequest);
    if (response.status !== 101) {
      // Any non-Upgrade response means the DO didn't take ownership of
      // the connection — release the slot ourselves.
      c.executionCtx.waitUntil(releaseOnFailure());
    }
    return response;
  } catch (err) {
    c.executionCtx.waitUntil(releaseOnFailure());
    throw err;
  }
});

app.notFound((c) => c.json(formatError("Not Found"), 404));

app.onError((err, c) => {
  const structured = {
    level: "error",
    message: err.message,
    stack: err.stack,
    path: c.req.path,
    method: c.req.method,
    timestamp: new Date().toISOString(),
  };
  console.log(JSON.stringify(structured));
  return c.json(formatError("Internal Server Error"), 500);
});

export default {
  fetch: app.fetch,
  /**
   * Cron trigger (1 min cadence per wrangler.json). Four jobs run in
   * parallel each tick:
   *   1. Kickstart the LtTicker DO if it's dormant. `/ensure` is idempotent.
   *      Ensures the price ticker self-heals within ~60s of any deploy, DO
   *      eviction, or transient failure without relying on user traffic.
   *   2. Sweep tokens currently in `pendingGraduation` and broadcast
   *      `finalizeGraduation` on each (phase 2 of the two-phase graduation
   *      flow). Idempotent — already-finalized tokens revert harmlessly.
   *      See `lib/graduation-keeper.ts`.
   *   3. Backfill any token that's on-chain but missing from the
   *      PostgreSQL `tokens` table. The frontend awaits the registration
   *      POST in the happy path; this catches closed-tab / lost-network /
   *      transient-5xx cases that would otherwise leave a token invisible.
   *      Idempotent. See `lib/registration-backfill.ts`.
   *   4. Daily retention sweep on `moderation_logs`. Self-gates to one
   *      tick per day (03:17 UTC) — the other 1,439 ticks return null
   *      immediately. Bounds storage cost as the moderation log grows
   *      with launch volume (issue #511). See
   *      `lib/moderation-logs-cleanup.ts`.
   */
  async scheduled(
    _controller: ScheduledController,
    env: AppBindings,
    ctx: ExecutionContext,
  ): Promise<void> {
    const id = env.LT_TICKER_DO.idFromName("lt-ticker");
    const stub = env.LT_TICKER_DO.get(id);
    ctx.waitUntil(
      stub.fetch("https://internal/ensure").catch((err) => {
        console.log(
          JSON.stringify({
            level: "error",
            event: "lt_ticker_kickstart_failed",
            error: err instanceof Error ? err.message : String(err),
            timestamp: new Date().toISOString(),
          }),
        );
      }),
    );

    ctx.waitUntil(
      runGraduationKeeper(env).catch((err) => {
        console.log(
          JSON.stringify({
            level: "error",
            event: "graduation_keeper_uncaught",
            error: err instanceof Error ? err.message : String(err),
            timestamp: new Date().toISOString(),
          }),
        );
      }),
    );

    ctx.waitUntil(
      runRegistrationBackfill(env).catch((err) => {
        console.log(
          JSON.stringify({
            level: "error",
            event: "registration_backfill_uncaught",
            error: err instanceof Error ? err.message : String(err),
            timestamp: new Date().toISOString(),
          }),
        );
      }),
    );

    ctx.waitUntil(
      runModerationLogsCleanup(env).catch((err) => {
        console.log(
          JSON.stringify({
            level: "error",
            event: "moderation_logs_cleanup_uncaught",
            error: err instanceof Error ? err.message : String(err),
            timestamp: new Date().toISOString(),
          }),
        );
      }),
    );
  },
};
