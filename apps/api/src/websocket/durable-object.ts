import { DurableObject } from "cloudflare:workers";

import { releaseIpSlot } from "./ip-limiter.js";

import type { AppBindings } from "../lib/types.js";

/** Sentinel routing key for global / wildcard subscribers on per-token channels. */
export const ALL_TOKENS_KEY = "__all__";

/** Channels that are inherently global (no per-token routing). */
const GLOBAL_CHANNELS = new Set(["newToken", "stats"]);

/** Interval between idle-check sweeps (ms). */
const IDLE_CHECK_INTERVAL_MS = 60_000;

/** Connections with no activity for this duration receive a ping (ms). */
const IDLE_PING_THRESHOLD_MS = 120_000;

/** Connections that don't respond to a ping within this duration are closed (ms). */
const PONG_TIMEOUT_MS = 30_000;

interface ConnectionMeta {
  /** Client IP address — needed to release the per-IP slot on close. */
  ip: string;
  /** Optional API key provided at connection or via first message. */
  apiKey: string | null;
  /** Timestamp of last activity (message received or pong). */
  lastActivity: number;
  /** Whether we are waiting for a pong response to our ping. */
  awaitingPong: boolean;
}

/**
 * Compute the deterministic shard key for a `(channel, tokenAddress?)` tuple.
 *
 * - Global channels (`newToken`, `stats`) ignore `tokenAddress`.
 * - Per-token channels (`trade`, `price`, `graduation`) shard by the
 *   lowercased token address. A missing `tokenAddress` is the wildcard
 *   shard for that channel — clients subscribing without a token live there
 *   and receive every event on the channel.
 *
 * Exported for tests and for the `/ws` route to compute the routing key.
 */
export function shardKeyFor(channel: string, tokenAddress?: string | null): string {
  if (GLOBAL_CHANNELS.has(channel)) {
    return `${channel}:${ALL_TOKENS_KEY}`;
  }
  const key = (tokenAddress ?? "").toLowerCase();
  if (!key) return `${channel}:${ALL_TOKENS_KEY}`;
  return `${channel}:${key}`;
}

/**
 * Compute the shards a broadcast event must be delivered to.
 *
 * For per-token channels, an event with a `tokenAddress` must reach:
 *   1. The token's own shard (subscribers scoped to that token).
 *   2. The wildcard `__all__` shard (clients subscribed to the channel
 *      with no token specified — e.g. the home-page global trade feed).
 *
 * Returning the deduped set keeps the global-channel and missing-token
 * cases simple (single shard).
 */
export function broadcastShardsFor(
  channel: string,
  tokenAddress?: string | null,
): string[] {
  if (GLOBAL_CHANNELS.has(channel) || !tokenAddress) {
    return [shardKeyFor(channel, tokenAddress)];
  }
  const tokenShard = shardKeyFor(channel, tokenAddress);
  const wildcardShard = `${channel}:${ALL_TOKENS_KEY}`;
  return tokenShard === wildcardShard
    ? [tokenShard]
    : [tokenShard, wildcardShard];
}

/**
 * Subject-scoped WebSocket Durable Object.
 *
 * One DO instance per `(channel, tokenAddress)` shard — see `shardKeyFor`.
 * Every connection on a given instance has already opted into exactly that
 * subject, so `broadcast()` is a flat fan-out with no per-connection filter.
 *
 * Architecture context (issue #395):
 * Previously a single `idFromName("global")` instance held *every* WS
 * connection in the fleet. Every event iterated every connection looking
 * for matching subscriptions — an N×M loop pinned to one isolate, with the
 * memory ceiling and event-loop saturation of any single CF Durable Object.
 *
 * The shard-by-subject design replaces that with O(N) DOs, each handling
 * its own slice. The frontend opens one WS per `(channel, token)` it cares
 * about (multiplexing handled in `apps/web/src/services/websocket.ts`),
 * which keeps each connection co-located with the only events it wants.
 *
 * Per-IP limits used to live in this DO; now they live in `WsIpLimiter`
 * (a single global DO that owns the IP→count map). The `/ws` route acquires
 * a slot before routing the upgrade here; this DO releases it on close.
 *
 * Security features kept here:
 * - Optional API key authentication (header on connect or first message).
 * - Idle connection timeout with ping/pong.
 * - Structured logging for monitoring.
 */
export class WebSocketDO extends DurableObject<AppBindings> {
  private connections: Map<WebSocket, ConnectionMeta> = new Map();
  private idleCheckInterval: ReturnType<typeof setInterval> | null = null;
  private subjectKey: string | null = null;

  private ensureIdleCheck() {
    if (this.idleCheckInterval) return;
    this.idleCheckInterval = setInterval(
      () => this.checkIdleConnections(),
      IDLE_CHECK_INTERVAL_MS,
    );
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
      if (
        meta.awaitingPong &&
        now - meta.lastActivity > IDLE_PING_THRESHOLD_MS + PONG_TIMEOUT_MS
      ) {
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

    if (this.connections.size === 0) {
      this.stopIdleCheck();
    }
  }

  private removeConnection(ws: WebSocket) {
    const meta = this.connections.get(ws);
    if (!meta) return;

    this.connections.delete(ws);

    // Fire-and-forget the per-IP release. We can't await inside
    // `webSocketClose`, so a transient limiter-DO failure leaks a slot
    // until the limiter's idle TTL sweep — acceptable.
    if (this.env.WS_IP_LIMITER_DO) {
      releaseIpSlot(this.env.WS_IP_LIMITER_DO, meta.ip).catch(() => {
        // Ignored — leaked slot, see comment above.
      });
    }

    this.log("info", "connection_closed", {
      ip: meta.ip,
      apiKey: meta.apiKey,
      shardConnections: this.connections.size,
    });
  }

  private log(level: string, event: string, data: Record<string, unknown>) {
    const entry = {
      level,
      event,
      timestamp: new Date().toISOString(),
      shard: this.subjectKey,
      shardConnections: this.connections.size,
      ...data,
    };
    console.log(JSON.stringify(entry));
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // The shard key isn't derivable from the DO id (idFromName is one-way),
    // so the caller stamps it on the request. We capture it on the first
    // call for log context. Cheap and idempotent.
    const subject = url.searchParams.get("shard");
    if (subject) this.subjectKey = subject;

    if (url.pathname === "/broadcast" && request.method === "POST") {
      const body = (await request.json()) as { data: unknown; channel: string };
      this.broadcast(body.channel, body.data);
      return new Response("ok", { status: 200 });
    }

    const upgradeHeader = request.headers.get("Upgrade");
    if (upgradeHeader?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    const clientIp = request.headers.get("X-Client-IP") ?? "unknown";
    const apiKey = request.headers.get("X-WS-API-Key") ?? null;

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.ctx.acceptWebSocket(server);

    const meta: ConnectionMeta = {
      ip: clientIp,
      apiKey,
      lastActivity: Date.now(),
      awaitingPong: false,
    };
    this.connections.set(server, meta);

    this.ensureIdleCheck();

    this.log("info", "connection_opened", {
      ip: clientIp,
      apiKey,
      shardConnections: this.connections.size,
    });

    // Optimistic implicit-subscribe: every connection on this DO already
    // wants exactly this subject, so confirm it immediately. The frontend
    // can still send a redundant `subscribe` for backwards compat.
    server.send(JSON.stringify({ type: "subscribed", shard: this.subjectKey }));

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

      meta.lastActivity = Date.now();

      if (data.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
        return;
      }

      if (data.type === "pong") {
        meta.awaitingPong = false;
        return;
      }

      if (data.type === "auth" && data.apiKey) {
        meta.apiKey = data.apiKey;
        ws.send(JSON.stringify({ type: "authenticated" }));
        this.log("info", "client_authenticated", {
          ip: meta.ip,
          apiKey: meta.apiKey,
        });
        return;
      }

      // Sharded model: subscriptions are determined at connect time by the
      // shard the connection landed on. Treat redundant subscribe/unsubscribe
      // messages as a no-op confirmation so legacy clients keep working.
      if (data.type === "subscribe" && data.channel) {
        ws.send(
          JSON.stringify({
            type: "subscribed",
            channel: data.channel,
            token: data.token ?? null,
          }),
        );
        return;
      }

      if (data.type === "unsubscribe" && data.channel) {
        // Real "unsubscribe" in the sharded model is "close this WS". We
        // ack the message but the client is responsible for closing the
        // connection if it no longer wants events on this shard.
        ws.send(
          JSON.stringify({
            type: "unsubscribed",
            channel: data.channel,
            token: data.token ?? null,
          }),
        );
        return;
      }
    } catch {
      // Ignore malformed messages.
    }
  }

  async webSocketClose(ws: WebSocket) {
    this.removeConnection(ws);
  }

  async webSocketError(ws: WebSocket) {
    this.removeConnection(ws);
  }

  /**
   * Flat fan-out to every connection on this shard. There is no per-event
   * filter loop because every connection already wants events for this
   * subject.
   *
   * The `channel` field is preserved on the wire so the frontend's
   * multiplexer can route the payload to the right handler when one shard
   * handles a single subject (always the case today).
   */
  broadcast(channel: string, data: unknown) {
    const payload = JSON.stringify({ channel, data });
    for (const [ws] of this.connections) {
      try {
        ws.send(payload);
      } catch {
        this.removeConnection(ws);
      }
    }
  }

  /** Test-only accessor for connection count. */
  get connectionCount(): number {
    return this.connections.size;
  }
}
