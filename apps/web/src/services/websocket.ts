type MessageHandler = (data: unknown) => void;
type OpenHandler = () => void;
type StatusHandler = () => void;
type TickerListener = () => void;

interface SubjectSubscription {
  channel: string;
  token?: string;
  handler: MessageHandler;
}

const PING_INTERVAL_MS = 30_000;
const INITIAL_RECONNECT_MS = 1_000;
const MAX_RECONNECT_MS = 30_000;
// Short verification window for post-wake probe pings.
const PROBE_TIMEOUT_MS = 5_000;
const ALL_TOKENS_KEY = "__all__";
const GLOBAL_CHANNELS = new Set(["newToken", "stats"]);

function subjectKey(channel: string, token: string | undefined): string {
  if (GLOBAL_CHANNELS.has(channel) || !token)
    return `${channel}:${ALL_TOKENS_KEY}`;
  return `${channel}:${token.toLowerCase()}`;
}

/** Worker-backed keep-alive ticker that avoids background-tab timer throttling. */
class KeepAliveTicker {
  private readonly listeners: Set<TickerListener> = new Set();
  private worker: Worker | null = null;
  private workerObjectUrl: string | null = null;
  private fallbackTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly intervalMs: number) {}

  subscribe(listener: TickerListener): () => void {
    this.listeners.add(listener);
    if (this.listeners.size === 1) this.start();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stop();
    };
  }

  private start(): void {
    if (this.worker || this.fallbackTimer) return;

    if (typeof Worker !== "undefined" && typeof Blob !== "undefined") {
      try {
        // Inline blob avoids a separate bundle entry and HTTP request.
        const code = [
          "let id = null;",
          'self.addEventListener("message", (e) => {',
          "  if (!e.data) return;",
          '  if (e.data.type === "start") {',
          "    if (id !== null) clearInterval(id);",
          '    id = setInterval(() => self.postMessage("tick"), e.data.intervalMs);',
          '  } else if (e.data.type === "stop") {',
          "    if (id !== null) { clearInterval(id); id = null; }",
          "  }",
          "});",
        ].join("\n");
        const blob = new Blob([code], { type: "application/javascript" });
        this.workerObjectUrl = URL.createObjectURL(blob);
        const worker = new Worker(this.workerObjectUrl);
        worker.onmessage = () => this.tick();
        worker.onerror = () => {
          // Fall back if the blob worker dies or CSP blocks it.
          this.teardownWorker();
          if (!this.fallbackTimer) {
            this.fallbackTimer = setInterval(
              () => this.tick(),
              this.intervalMs,
            );
          }
        };
        worker.postMessage({ type: "start", intervalMs: this.intervalMs });
        this.worker = worker;
        return;
      } catch {
        // Fall through to the setInterval path.
        this.teardownWorker();
      }
    }

    this.fallbackTimer = setInterval(() => this.tick(), this.intervalMs);
  }

  private stop(): void {
    this.teardownWorker();
    if (this.fallbackTimer) {
      clearInterval(this.fallbackTimer);
      this.fallbackTimer = null;
    }
  }

  private teardownWorker(): void {
    if (this.worker) {
      try {
        this.worker.postMessage({ type: "stop" });
        this.worker.terminate();
      } catch {
        // already terminated — nothing to do
      }
      this.worker = null;
    }
    if (this.workerObjectUrl) {
      try {
        URL.revokeObjectURL(this.workerObjectUrl);
      } catch {
        // safe to ignore
      }
      this.workerObjectUrl = null;
    }
  }

  private tick(): void {
    // Snapshot so listeners can unsubscribe during fan-out.
    const snapshot = Array.from(this.listeners);
    for (const listener of snapshot) {
      try {
        listener();
      } catch {
        // One bad listener can't break the keep-alive for everyone else.
      }
    }
  }
}

const pingTicker = new KeepAliveTicker(PING_INTERVAL_MS);

/** Owns one subject-sharded WebSocket and its reconnect lifecycle. */
class SubjectSocket {
  private ws: WebSocket | null = null;
  private reconnectMs = INITIAL_RECONNECT_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private tickerUnsub: (() => void) | null = null;
  private probeTimer: ReturnType<typeof setTimeout> | null = null;
  // Separate regular/probe pong flags so wake probes don't trip the 30s cycle.
  private awaitingPong = false;
  private awaitingProbe = false;
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
    private readonly onStatusChange: () => void,
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
      // Only fire reconnection handlers on reopens.
      if (this.hasOpenedOnce) {
        try {
          this.onReopen();
        } catch {
          // ignore — one bad listener can't break the stream
        }
      }
      this.hasOpenedOnce = true;
      this.onStatusChange();
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as {
          type?: string;
          channel?: string;
          data?: unknown;
        };

        if (msg.type === "pong") {
          this.onPongReceived();
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
      this.onStatusChange();
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  get hasConnectionIssue(): boolean {
    return (
      this.reconnectTimer !== null || (this.hasOpenedOnce && !this.isConnected)
    );
  }

  dispose(): void {
    this.disposed = true;
    this.cleanup();
    this.handlers.clear();
  }

  /** Probe or reconnect this subject after foreground/network wake. */
  wake(): void {
    if (this.disposed) return;

    const ws = this.ws;
    if (
      !ws ||
      ws.readyState === WebSocket.CLOSED ||
      ws.readyState === WebSocket.CLOSING
    ) {
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      this.reconnectMs = INITIAL_RECONNECT_MS;
      this.connect();
      return;
    }

    if (ws.readyState === WebSocket.OPEN) {
      this.sendProbePing();
    }
  }

  private startPing(): void {
    this.stopPing();
    this.tickerUnsub = pingTicker.subscribe(() => this.onPingTick());
  }

  private stopPing(): void {
    if (this.tickerUnsub) {
      this.tickerUnsub();
      this.tickerUnsub = null;
    }
    if (this.probeTimer) {
      clearTimeout(this.probeTimer);
      this.probeTimer = null;
    }
    this.awaitingPong = false;
    this.awaitingProbe = false;
  }

  private onPingTick(): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;

    // Force-close wedged sockets so the normal reconnect path runs.
    if (this.awaitingPong) {
      try {
        this.ws.close();
      } catch {
        // already closing — onclose will fire either way
      }
      return;
    }

    try {
      this.ws.send(JSON.stringify({ type: "ping" }));
      this.awaitingPong = true;
    } catch {
      // send failed — onclose will fire and trigger reconnect
    }
  }

  private sendProbePing(): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify({ type: "ping" }));
      this.awaitingProbe = true;
    } catch {
      // send failed — onclose will fire and trigger reconnect
      return;
    }
    if (this.probeTimer) clearTimeout(this.probeTimer);
    // Force-close quickly if the probe pong doesn't land.
    this.probeTimer = setTimeout(() => {
      this.probeTimer = null;
      if (this.disposed) return;
      if (this.awaitingProbe && this.ws?.readyState === WebSocket.OPEN) {
        try {
          this.ws.close();
        } catch {
          // already closing — onclose will fire either way
        }
      }
    }, PROBE_TIMEOUT_MS);
  }

  private onPongReceived(): void {
    // Pongs are unsequenced; any pong proves the round-trip succeeded.
    this.awaitingPong = false;
    this.awaitingProbe = false;
    if (this.probeTimer) {
      clearTimeout(this.probeTimer);
      this.probeTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer) return;
    // Snapshot this timer's delay before advancing the next backoff.
    const delay = this.reconnectMs;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
      this.reconnectMs = Math.min(this.reconnectMs * 2, MAX_RECONNECT_MS);
      this.onStatusChange();
    }, delay);
    this.onStatusChange();
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

/** Multiplexes callers across one WebSocket per `(channel, token)` subject. */
class WebSocketClient {
  private url: string;
  private subjects: Map<string, SubjectSocket> = new Map();
  private subscriptions: Map<string, SubjectSubscription> = new Map();
  private openHandlers: Set<OpenHandler> = new Set();
  private statusHandlers: Set<StatusHandler> = new Set();
  private subIdCounter = 0;
  private disposed = false;

  constructor(url: string) {
    this.url = url;
  }

  /** Best-effort indicator that some subject is connected. */
  get isConnected(): boolean {
    if (this.subjects.size === 0) return false;
    for (const s of this.subjects.values()) {
      if (s.isConnected) return true;
    }
    return false;
  }

  get hasConnectionIssue(): boolean {
    for (const s of this.subjects.values()) {
      if (s.hasConnectionIssue) return true;
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
      subject = new SubjectSocket(
        this.url,
        channel,
        token,
        () => {
          for (const fn of this.openHandlers) {
            try {
              fn();
            } catch {
              // ignore
            }
          }
        },
        () => this.emitStatusChange(),
      );
      this.subjects.set(key, subject);
      subject.connect();
      this.emitStatusChange();
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
        this.emitStatusChange();
      }
    };
  }

  /** Subscribe to subject reopens. */
  onReconnect(handler: OpenHandler): () => void {
    this.openHandlers.add(handler);
    return () => {
      this.openHandlers.delete(handler);
    };
  }

  subscribeStatus(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler);
    return () => {
      this.statusHandlers.delete(handler);
    };
  }

  /** Probe every active subject socket after document/network wake. */
  wakeAll(): void {
    if (this.disposed) return;
    const snapshot = Array.from(this.subjects.values());
    for (const subject of snapshot) {
      try {
        subject.wake();
      } catch {
        // one bad subject can't block the wake-up for everyone else
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const sub of this.subjects.values()) sub.dispose();
    this.subjects.clear();
    this.subscriptions.clear();
    this.openHandlers.clear();
    this.statusHandlers.clear();
  }

  private emitStatusChange(): void {
    for (const fn of this.statusHandlers) {
      try {
        fn();
      } catch {
        // ignore
      }
    }
  }
}

let instance: WebSocketClient | null = null;
let lifecycleWatchersInstalled = false;

/** Wire foreground/network wake events to WebSocket probes. */
function installLifecycleWatchers(client: WebSocketClient): void {
  if (lifecycleWatchersInstalled) return;
  if (typeof document === "undefined" && typeof window === "undefined") return;
  lifecycleWatchersInstalled = true;

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        client.wakeAll();
      }
    });
  }

  if (typeof window !== "undefined") {
    window.addEventListener("online", () => {
      client.wakeAll();
    });
  }
}

export function getWebSocketClient(): WebSocketClient | null {
  if (instance) return instance;

  const wsUrl = import.meta.env.VITE_WS_URL as string | undefined;
  if (!wsUrl) return null;

  instance = new WebSocketClient(wsUrl);
  installLifecycleWatchers(instance);
  return instance;
}

export { WebSocketClient };
export type { MessageHandler };
