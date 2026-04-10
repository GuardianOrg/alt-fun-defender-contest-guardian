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

app.notFound((c) => c.json(formatError("Not Found"), 404));

app.onError((err, c) => {
  console.error("Error:", err);
  return c.json(formatError("Internal Server Error"), 500);
});

export class WebSocketDO extends DurableObject {
  private connections: Set<WebSocket> = new Set();

  async fetch(request: Request): Promise<Response> {
    const upgradeHeader = request.headers.get("Upgrade");
    if (upgradeHeader !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.ctx.acceptWebSocket(server);
    this.connections.add(server);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    try {
      const data = JSON.parse(message as string);
      if (data.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
      }
    } catch {
      // Ignore malformed messages
    }
  }

  async webSocketClose(ws: WebSocket) {
    this.connections.delete(ws);
  }

  broadcast(message: string) {
    for (const ws of this.connections) {
      try {
        ws.send(message);
      } catch {
        this.connections.delete(ws);
      }
    }
  }
}

export default app;
