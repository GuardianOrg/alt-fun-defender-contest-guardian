import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { prettyJSON } from "hono/pretty-json";
import { DurableObject } from "cloudflare:workers";

import formatSuccess from "./utils/format-success.js";
import formatError from "./utils/format-error.js";
import tokens from "./routes/tokens.js";
import trades from "./routes/trades.js";
import creators from "./routes/creators.js";
import admin from "./routes/admin.js";
import images from "./routes/images.js";
import commentsRoute from "./routes/comments.js";
import portfolio from "./routes/portfolio.js";
import stats from "./routes/stats.js";
import assets from "./routes/assets.js";
import referrals from "./routes/referrals.js";
import holders from "./routes/holders.js";
import security from "./routes/security.js";
import { apiKeyAuth } from "./middleware/api-key-auth.js";

import type { AppBindings } from "./lib/types.js";

const app = new Hono<{ Bindings: AppBindings }>();

app.use("*", logger());
app.use("*", cors());
app.use("*", prettyJSON());

app.get("/", (c) => c.json(formatSuccess("launchpad API")));
app.get("/health", (c) => c.json(formatSuccess("healthy")));

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

interface ChannelSub {
  /** When true, receives all messages on this channel regardless of token. */
  global: boolean;
  /** Token addresses this subscription is scoped to (empty = global only). */
  tokens: Set<string>;
}

interface ConnectionMeta {
  channels: Map<string, ChannelSub>;
  /** Client IP address for per-IP tracking. */
  ip: string;
  /** Optional API key provided at connection or via first message. */
  apiKey: string | null;
  /** Timestamp of last activity (message received or pong). */
  lastActivity: number;
  /** Whether we are waiting for a pong response to our ping. */
  awaitingPong: boolean;
}

/** Maximum concurrent WebSocket connections allowed per IP address. */
const MAX_CONNECTIONS_PER_IP = 10;

/** Interval between idle-check sweeps (ms). */
const IDLE_CHECK_INTERVAL_MS = 60_000;

/** Connections with no activity for this duration receive a ping (ms). */
const IDLE_PING_THRESHOLD_MS = 120_000;

/** Connections that don't respond to a ping within this duration are closed (ms). */
const PONG_TIMEOUT_MS = 30_000;

/**
 * WebSocket Durable Object — manages real-time client subscriptions.
 * Canonical channel list is defined in the channelMap above and documented in docs/backend-scope.md.
 *
 * Security features:
 * - Per-IP connection limits (MAX_CONNECTIONS_PER_IP)
 * - Optional API key authentication (query param or first message)
 * - Idle connection timeout with ping/pong
 * - Structured logging for monitoring
 */
export class WebSocketDO extends DurableObject {
  private connections: Map<WebSocket, ConnectionMeta> = new Map();
  private ipConnectionCounts: Map<string, number> = new Map();
  private idleCheckInterval: ReturnType<typeof setInterval> | null = null;

  private ensureIdleCheck() {
    if (this.idleCheckInterval) return;
    this.idleCheckInterval = setInterval(() => this.checkIdleConnections(), IDLE_CHECK_INTERVAL_MS);
  }

  private stopIdleCheck() {
    if (this.idleCheckInterval) {
      clearInterval(this.idleCheckInterval);
      this.idleCheckInterval = null;
    }
  }

  private checkIdleConnections() {
    const now = Date.now();
    for (const [ws, meta] of this.connections) {
      if (meta.awaitingPong && now - meta.lastActivity > IDLE_PING_THRESHOLD_MS + PONG_TIMEOUT_MS) {
        this.log("info", "closing_idle_connection", {
          ip: meta.ip,
          apiKey: meta.apiKey,
          idleMs: now - meta.lastActivity,
        });
        this.removeConnection(ws);
        try {
          ws.close(1000, "Idle timeout");
        } catch {
          // Already closed
        }
        continue;
      }

      if (!meta.awaitingPong && now - meta.lastActivity > IDLE_PING_THRESHOLD_MS) {
        try {
          ws.send(JSON.stringify({ type: "ping" }));
          meta.awaitingPong = true;
        } catch {
          this.removeConnection(ws);
        }
      }
    }

    // Stop the interval if there are no connections
    if (this.connections.size === 0) {
      this.stopIdleCheck();
    }
  }

  private removeConnection(ws: WebSocket) {
    const meta = this.connections.get(ws);
    if (!meta) return;

    const count = this.ipConnectionCounts.get(meta.ip) ?? 0;
    if (count <= 1) {
      this.ipConnectionCounts.delete(meta.ip);
    } else {
      this.ipConnectionCounts.set(meta.ip, count - 1);
    }

    this.connections.delete(ws);

    this.log("info", "connection_closed", {
      ip: meta.ip,
      apiKey: meta.apiKey,
      totalConnections: this.connections.size,
      ipConnections: this.ipConnectionCounts.get(meta.ip) ?? 0,
    });
  }

  private log(level: string, event: string, data: Record<string, unknown>) {
    const entry = {
      level,
      event,
      timestamp: new Date().toISOString(),
      totalConnections: this.connections.size,
      ...data,
    };
    console.log(JSON.stringify(entry));
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/broadcast" && request.method === "POST") {
      const body = (await request.json()) as {
        channel: string;
        data: unknown;
        tokenAddress?: string;
      };
      this.broadcast(body.channel, body.data, body.tokenAddress);
      return new Response("ok", { status: 200 });
    }

    const upgradeHeader = request.headers.get("Upgrade");
    if (upgradeHeader?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    const clientIp = request.headers.get("X-Client-IP") ?? "unknown";
    const apiKey = request.headers.get("X-WS-API-Key") ?? null;

    // Enforce per-IP connection limit
    const currentCount = this.ipConnectionCounts.get(clientIp) ?? 0;
    if (currentCount >= MAX_CONNECTIONS_PER_IP) {
      this.log("warn", "connection_rejected", {
        ip: clientIp,
        apiKey,
        reason: "ip_limit_exceeded",
        ipConnections: currentCount,
      });
      return new Response(
        JSON.stringify({ error: "Too many connections from this IP" }),
        { status: 429, headers: { "Content-Type": "application/json" } },
      );
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.ctx.acceptWebSocket(server);

    const meta: ConnectionMeta = {
      channels: new Map(),
      ip: clientIp,
      apiKey,
      lastActivity: Date.now(),
      awaitingPong: false,
    };
    this.connections.set(server, meta);
    this.ipConnectionCounts.set(clientIp, currentCount + 1);

    this.ensureIdleCheck();

    this.log("info", "connection_opened", {
      ip: clientIp,
      apiKey,
      totalConnections: this.connections.size,
      ipConnections: currentCount + 1,
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    try {
      const data = JSON.parse(message as string) as {
        type: string;
        channel?: string;
        token?: string;
        apiKey?: string;
      };

      const meta = this.connections.get(ws);
      if (!meta) return;

      // Update activity timestamp on any message
      meta.lastActivity = Date.now();

      if (data.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
        return;
      }

      if (data.type === "pong") {
        meta.awaitingPong = false;
        return;
      }

      // Allow API key to be sent as first message for clients that can't set query params
      if (data.type === "auth" && data.apiKey) {
        meta.apiKey = data.apiKey;
        ws.send(JSON.stringify({ type: "authenticated" }));
        this.log("info", "client_authenticated", {
          ip: meta.ip,
          apiKey: meta.apiKey,
        });
        return;
      }

      if (data.type === "subscribe" && data.channel) {
        let chanSub = meta.channels.get(data.channel);
        if (!chanSub) {
          chanSub = { global: false, tokens: new Set() };
          meta.channels.set(data.channel, chanSub);
        }
        if (data.token) {
          chanSub.tokens.add(data.token);
        } else {
          chanSub.global = true;
        }
        this.log("info", "channel_subscribed", {
          ip: meta.ip,
          apiKey: meta.apiKey,
          channel: data.channel,
          token: data.token ?? null,
        });
        ws.send(JSON.stringify({ type: "subscribed", channel: data.channel }));
        return;
      }

      if (data.type === "unsubscribe" && data.channel) {
        const chanSub = meta.channels.get(data.channel);
        if (chanSub) {
          if (data.token) {
            chanSub.tokens.delete(data.token);
          } else {
            chanSub.global = false;
          }
          if (!chanSub.global && chanSub.tokens.size === 0) {
            meta.channels.delete(data.channel);
          }
        }
        ws.send(JSON.stringify({ type: "unsubscribed", channel: data.channel }));
      }
    } catch {
      // Ignore malformed messages
    }
  }

  async webSocketClose(ws: WebSocket) {
    this.removeConnection(ws);
  }

  async webSocketError(ws: WebSocket) {
    this.removeConnection(ws);
  }

  broadcast(channel: string, data: unknown, tokenAddress?: string) {
    const payload = JSON.stringify({ channel, data });
    for (const [ws, meta] of this.connections) {
      const chanSub = meta.channels.get(channel);
      if (!chanSub) continue;
      if (tokenAddress && !chanSub.global && !chanSub.tokens.has(tokenAddress)) continue;
      try {
        ws.send(payload);
      } catch {
        this.removeConnection(ws);
      }
    }
  }
}

export default app;
