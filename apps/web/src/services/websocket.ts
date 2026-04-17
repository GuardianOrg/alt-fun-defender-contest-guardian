type MessageHandler = (data: unknown) => void;
type OpenHandler = () => void;

interface ChannelSubscription {
  channel: string;
  token?: string;
  handler: MessageHandler;
}

const PING_INTERVAL_MS = 30_000;
const INITIAL_RECONNECT_MS = 1_000;
const MAX_RECONNECT_MS = 30_000;

class WebSocketClient {
  private ws: WebSocket | null = null;
  private url: string;
  private subscriptions: Map<string, ChannelSubscription> = new Map();
  private openHandlers: Set<OpenHandler> = new Set();
  private reconnectMs = INITIAL_RECONNECT_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;
  private subIdCounter = 0;
  private hasOpenedOnce = false;

  constructor(url: string) {
    this.url = url;
  }

  connect(): void {
    if (this.disposed || !this.url) return;
    this.cleanup();

    try {
      this.ws = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.reconnectMs = INITIAL_RECONNECT_MS;
      this.startPing();
      for (const sub of this.subscriptions.values()) {
        this.sendSubscribe(sub.channel, sub.token);
      }
      // Only fire reconnection handlers on *re*opens, not the first connect —
      // callers already have their initial snapshot then. Downstream hooks
      // (useChartData) use this to refetch after a drop so they resync any
      // state they might have missed while disconnected.
      if (this.hasOpenedOnce) {
        for (const fn of this.openHandlers) {
          try {
            fn();
          } catch {
            // ignore handler throws; one bad listener can't break the stream
          }
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

        if (msg.type === "pong" || msg.type === "subscribed" || msg.type === "unsubscribed") {
          return;
        }

        if (msg.channel && msg.data !== undefined) {
          for (const sub of this.subscriptions.values()) {
            if (sub.channel === msg.channel) {
              sub.handler(msg.data);
            }
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

  subscribe(channel: string, handler: MessageHandler, token?: string): () => void {
    const id = String(++this.subIdCounter);
    this.subscriptions.set(id, { channel, token, handler });

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendSubscribe(channel, token);
    }

    return () => {
      this.subscriptions.delete(id);
      if (this.ws?.readyState !== WebSocket.OPEN) return;

      const remaining = [...this.subscriptions.values()];

      if (token) {
        // Token-scoped: unsubscribe the token if no other sub references it
        const tokenStillUsed = remaining.some(
          (s) => s.channel === channel && s.token === token,
        );
        if (!tokenStillUsed) {
          this.sendUnsubscribe(channel, token);
        }
      } else {
        // Global: unsubscribe the channel (global flag) if no other global sub exists
        const globalStillUsed = remaining.some(
          (s) => s.channel === channel && !s.token,
        );
        if (!globalStillUsed) {
          this.sendUnsubscribe(channel);
        }
      }
    };
  }

  /**
   * Subscribe to reconnect events. Fires only on *re*opens (not the first
   * connect). Returns an unsubscribe function.
   */
  onReconnect(handler: OpenHandler): () => void {
    this.openHandlers.add(handler);
    return () => {
      this.openHandlers.delete(handler);
    };
  }

  dispose(): void {
    this.disposed = true;
    this.cleanup();
    this.subscriptions.clear();
    this.openHandlers.clear();
  }

  private sendSubscribe(channel: string, token?: string): void {
    const msg: Record<string, string> = { type: "subscribe", channel };
    if (token) msg.token = token;
    this.ws?.send(JSON.stringify(msg));
  }

  private sendUnsubscribe(channel: string, token?: string): void {
    const msg: Record<string, string> = { type: "unsubscribe", channel };
    if (token) msg.token = token;
    this.ws?.send(JSON.stringify(msg));
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
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close();
      }
      this.ws = null;
    }
  }
}

let instance: WebSocketClient | null = null;

export function getWebSocketClient(): WebSocketClient | null {
  if (instance) return instance;

  const wsUrl = import.meta.env.VITE_WS_URL as string | undefined;
  if (!wsUrl) return null;

  instance = new WebSocketClient(wsUrl);
  instance.connect();
  return instance;
}

export type { WebSocketClient, MessageHandler };
