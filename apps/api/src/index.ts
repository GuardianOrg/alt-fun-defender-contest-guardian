import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { prettyJSON } from "hono/pretty-json";
import { swaggerUI } from "@hono/swagger-ui";

import formatSuccess from "./utils/format-success.js";
import formatError from "./utils/format-error.js";
import { checkPonderHealth } from "./lib/ponder-client.js";
import tokens from "./routes/tokens/index.js";
import trades from "./routes/trades.js";
import creators from "./routes/creators.js";
import admin from "./routes/admin/index.js";
import images from "./routes/images.js";
import commentsRoute from "./routes/comments.js";
import portfolio from "./routes/portfolio.js";
import stats from "./routes/stats.js";
import assets from "./routes/assets.js";
import referrals from "./routes/referrals.js";
import holders from "./routes/holders.js";
import security from "./routes/security.js";
import profiles from "./routes/profiles.js";
import { apiKeyAuth } from "./middleware/api-key-auth.js";
import openApiSpec from "./openapi/spec.js";

import type { AppBindings } from "./lib/types.js";

export { WebSocketDO } from "./websocket/durable-object.js";

const app = new Hono<{ Bindings: AppBindings }>();

app.use("*", logger());
app.use("*", cors());
app.use("*", prettyJSON());

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

app.use("/api/v1/*", apiKeyAuth);

app.route("/api/v1/tokens", tokens);
app.route("/api/v1/trades", trades);
app.route("/api/v1/creators", creators);
app.route("/api/v1/admin", admin);
app.route("/api/v1/images", images);
app.route("/images", images);
app.route("/api/v1/tokens", commentsRoute);
app.route("/api/v1/portfolio", portfolio);
app.route("/api/v1/stats", stats);
app.route("/api/v1/assets", assets);
app.route("/api/v1/referrals", referrals);
app.route("/api/v1/holders", holders);
app.route("/api/v1/security", security);
app.route("/api/v1/profiles", profiles);

app.post("/api/v1/webhook/indexer", async (c) => {
  const adminKey = c.req.header("X-Admin-Key");
  if (!adminKey || adminKey !== c.env.ADMIN_API_KEY) {
    return c.json(formatError("Unauthorized"), 401);
  }

  const body = (await c.req.json()) as {
    event: string;
    data: unknown;
    tokenAddress?: string;
  };

  const channelMap: Record<string, string> = {
    trade: "trade",
    newToken: "newToken",
    graduation: "graduation",
    price: "price",
    stats: "stats",
  };

  const channel = channelMap[body.event];
  if (!channel) {
    return c.json(formatError(`Unknown event type: ${body.event}`), 400);
  }

  const { broadcastToChannel } = await import("./lib/broadcast.js");
  await broadcastToChannel(c.env, channel, body.data, body.tokenAddress);

  return c.json(formatSuccess({ broadcasted: true }));
});

app.get("/ws", async (c) => {
  const upgradeHeader = c.req.header("Upgrade");
  if (upgradeHeader?.toLowerCase() !== "websocket") {
    return c.json(formatError("Expected WebSocket upgrade"), 426);
  }

  const id = c.env.WEBSOCKET_DO.idFromName("global");
  const stub = c.env.WEBSOCKET_DO.get(id);

  // Forward client IP and optional API key to the Durable Object
  const headers = new Headers(c.req.raw.headers);
  const clientIp = c.req.header("CF-Connecting-IP") ?? c.req.header("X-Forwarded-For") ?? "unknown";
  headers.set("X-Client-IP", clientIp);

  const apiKey = new URL(c.req.url).searchParams.get("apiKey");
  if (apiKey) {
    headers.set("X-WS-API-Key", apiKey);
  }

  const doRequest = new Request(c.req.raw.url, {
    method: c.req.raw.method,
    headers,
  });

  return stub.fetch(doRequest);
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

export default app;
