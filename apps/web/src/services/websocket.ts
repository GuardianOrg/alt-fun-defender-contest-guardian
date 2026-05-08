type MessageHandler = (data: unknown) => void;
type OpenHandler = () => void;

interface SubjectSubscription {
  channel: string;
  token?: string;
  handler: MessageHandler;
}

const PING_INTERVAL_MS = 30_000;
const INITIAL_RECONNECT_MS = 1_000;
const MAX_RECONNECT_MS = 30_000;
const ALL_TOKENS_KEY = "__all__";
const GLOBAL_CHANNELS = new Set(["newToken", "stats"]);

function subjectKey(channel: string, token: string | undefined): string {
  if (GLOBAL_CHANNELS.has(channel) || !token) return `${channel}:${ALL_TOKENS_KEY}`;
  return `${channel}:${token.toLowerCase()}`;
}

/**
 * Per-subject WebSocket holder.
 *
 * Owns the lifecycle of a single WS that receives events for one
 * `(channel, token?)` subject — mirroring the API's subject-sharded
 * `WebSocketDO` (issue #395). Reconnect with exponential backoff is
 * scoped to this subject only, so a flap on one shard doesn't cascade
 * across every subscription a client holds.
 */
class SubjectSocket {
  private ws: WebSocket | null = null;
  private reconnectMs = INITIAL_RECONNECT_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;
  private hasOpenedOnce = false;

  readonly channel: string;
  readonly token: string | undefined;
  readonly handlers: Map<string, MessageHandler> = new Map();

  constructor(
    private readonly baseUrl: string,
    channel: string,
    token: string | undefined,
    private readonly onReopen: () => void,
  ) {
    this.channel = channel;
    this.token = token;
  }

  connect(): void {
    if (this.disposed) return;
    this.cleanup();

    const url = new URL(this.baseUrl);
    url.searchParams.set("channel", this.channel);
    if (this.token) url.searchParams.set("token", this.token);

    try {
      this.ws = new WebSocket(url.toString());
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.reconnectMs = INITIAL_RECONNECT_MS;
      this.startPing();
      // Only fire reconnection handlers on *re*opens. The subject shard
      // implicitly subscribes the connection on accept, so there's no
      // explicit subscribe message to send.
      if (this.hasOpenedOnce) {
        try {
          this.onReopen();
        } catch {
          // ignore — one bad listener can't break the stream
        }
      }
      this.hasOpenedOnce = true;
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as {
          type?: string;
          channel?: string;
          data?: unknown;
        };

        if (
          msg.type === "pong" ||
          msg.type === "subscribed" ||
          msg.type === "unsubscribed" ||
          msg.type === "authenticated"
        ) {
          return;
        }

        // Server sends a `ping` to detect idle clients; mirror back a `pong`.
        if (msg.type === "ping") {
          this.ws?.send(JSON.stringify({ type: "pong" }));
          return;
        }

        if (msg.channel && msg.data !== undefined) {
          for (const handler of this.handlers.values()) {
            handler(msg.data);
          }
        }
      } catch {
        // ignore malformed messages
      }
    };

    this.ws.onclose = () => {
      this.stopPing();
      if (!this.disposed) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  dispose(): void {
    this.disposed = true;
    this.cleanup();
    this.handlers.clear();
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "ping" }));
      }
    }, PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectMs = Math.min(this.reconnectMs * 2, MAX_RECONNECT_MS);
      this.connect();
    }, this.reconnectMs);
  }

  private cleanup(): void {
    this.stopPing();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      if (
        this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING
      ) {
        this.ws.close();
      }
      this.ws = null;
    }
  }
}

/**
 * Multiplexing WebSocket client.
 *
 * Maintains one underlying WebSocket per `(channel, token)` subject — each
 * connection lands on its own shard of the API's subject-sharded
 * `WebSocketDO` (issue #395). The public surface (`subscribe`, `onReconnect`)
 * is unchanged, so callers see no difference from the previous single-WS
 * implementation.
 *
 * Lifetime rules:
 *   - First subscriber for a subject opens its WS.
 *   - Last subscriber for a subject closes its WS.
 *   - `onReconnect` fires on *re*opens of any subject WS — downstream
 *     hooks use it to refetch their REST snapshot.
 */
class WebSocketClient {
  private url: string;
  private subjects: Map<string, SubjectSocket> = new Map();
  private subscriptions: Map<string, SubjectSubscription> = new Map();
  private openHandlers: Set<OpenHandler> = new Set();
  private subIdCounter = 0;
  private disposed = false;

  constructor(url: string) {
    this.url = url;
  }

  /**
   * Best-effort indicator that *some* subject is connected. Mirrors the
   * old `isConnected` semantics for callers that gate poll cadence on it.
   * Returns `false` when no subject is currently subscribed.
   */
  get isConnected(): boolean {
    if (this.subjects.size === 0) return false;
    for (const s of this.subjects.values()) {
      if (s.isConnected) return true;
    }
    return false;
  }

  subscribe(
    channel: string,
    handler: MessageHandler,
    token?: string,
  ): () => void {
    if (this.disposed || !this.url) return () => {};

    const id = String(++this.subIdCounter);
    this.subscriptions.set(id, { channel, token, handler });

    const key = subjectKey(channel, token);
    let subject = this.subjects.get(key);
    if (!subject) {
      subject = new SubjectSocket(this.url, channel, token, () => {
        for (const fn of this.openHandlers) {
          try {
            fn();
          } catch {
            // ignore
          }
        }
      });
      this.subjects.set(key, subject);
      subject.connect();
    }
    subject.handlers.set(id, handler);

    return () => {
      this.subscriptions.delete(id);
      const sub = this.subjects.get(key);
      if (!sub) return;
      sub.handlers.delete(id);
      if (sub.handlers.size === 0) {
        sub.dispose();
        this.subjects.delete(key);
      }
    };
  }

  /**
   * Subscribe to reconnect events. Fires only on *re*opens (not the first
   * connect) of any subject socket. Returns an unsubscribe function.
   */
  onReconnect(handler: OpenHandler): () => void {
    this.openHandlers.add(handler);
    return () => {
      this.openHandlers.delete(handler);
    };
  }

  dispose(): void {
    this.disposed = true;
    for (const sub of this.subjects.values()) sub.dispose();
    this.subjects.clear();
    this.subscriptions.clear();
    this.openHandlers.clear();
  }
}

let instance: WebSocketClient | null = null;

export function getWebSocketClient(): WebSocketClient | null {
  if (instance) return instance;

  const wsUrl = import.meta.env.VITE_WS_URL as string | undefined;
  if (!wsUrl) return null;

  instance = new WebSocketClient(wsUrl);
  return instance;
}

export type { WebSocketClient, MessageHandler };
