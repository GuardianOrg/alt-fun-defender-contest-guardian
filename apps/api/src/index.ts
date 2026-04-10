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

import type { AppBindings } from "./lib/types.js";

const app = new Hono<{ Bindings: AppBindings }>();

app.use("*", logger());
app.use("*", cors());
app.use("*", prettyJSON());

app.get("/", (c) => c.json(formatSuccess("launchpad API")));
app.get("/health", (c) => c.json(formatSuccess("healthy")));

app.route("/api/v1/tokens", tokens);
app.route("/api/v1/trades", trades);
app.route("/api/v1/creators", creators);
app.route("/api/v1/admin", admin);
app.route("/api/v1/images", images);
app.route("/images", images);
app.route("/api/v1/comments", commentsRoute);
app.route("/api/v1/portfolio", portfolio);
app.route("/api/v1/stats", stats);
app.route("/api/v1/assets", assets);
app.route("/api/v1/referrals", referrals);
app.route("/api/v1/holders", holders);
app.route("/api/v1/security", security);

app.get("/ws", async (c) => {
  const upgradeHeader = c.req.header("Upgrade");
  if (upgradeHeader?.toLowerCase() !== "websocket") {
    return c.json(formatError("Expected WebSocket upgrade"), 426);
  }

  const id = c.env.WEBSOCKET_DO.idFromName("global");
  const stub = c.env.WEBSOCKET_DO.get(id);
  return stub.fetch(c.req.raw);
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

interface Subscription {
  channels: Set<string>;
  tokens: Set<string>;
}

export class WebSocketDO extends DurableObject {
  private connections: Map<WebSocket, Subscription> = new Map();

  async fetch(request: Request): Promise<Response> {
    const upgradeHeader = request.headers.get("Upgrade");
    if (upgradeHeader?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.ctx.acceptWebSocket(server);
    this.connections.set(server, { channels: new Set(), tokens: new Set() });

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    try {
      const data = JSON.parse(message as string) as {
        type: string;
        channel?: string;
        token?: string;
      };

      if (data.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
        return;
      }

      const sub = this.connections.get(ws);
      if (!sub) return;

      if (data.type === "subscribe" && data.channel) {
        sub.channels.add(data.channel);
        if (data.token) sub.tokens.add(data.token);
        ws.send(JSON.stringify({ type: "subscribed", channel: data.channel }));
        return;
      }

      if (data.type === "unsubscribe" && data.channel) {
        sub.channels.delete(data.channel);
        if (data.token) sub.tokens.delete(data.token);
        ws.send(JSON.stringify({ type: "unsubscribed", channel: data.channel }));
      }
    } catch {
      // Ignore malformed messages
    }
  }

  async webSocketClose(ws: WebSocket) {
    this.connections.delete(ws);
  }

  broadcast(channel: string, data: unknown, tokenAddress?: string) {
    const payload = JSON.stringify({ channel, data });
    for (const [ws, sub] of this.connections) {
      if (!sub.channels.has(channel)) continue;
      if (tokenAddress && sub.tokens.size > 0 && !sub.tokens.has(tokenAddress)) continue;
      try {
        ws.send(payload);
      } catch {
        this.connections.delete(ws);
      }
    }
  }
}

export default app;
