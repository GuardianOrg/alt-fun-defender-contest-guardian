type MessageHandler = (data: unknown) => void;
type OpenHandler = () => void;
type TickerListener = () => void;

interface SubjectSubscription {
  channel: string;
  token?: string;
  handler: MessageHandler;
}

const PING_INTERVAL_MS = 30_000;
const INITIAL_RECONNECT_MS = 1_000;
const MAX_RECONNECT_MS = 30_000;
// Short verification window for the post-wake probe ping. The regular 30 s
// ping interval also detects a missed pong, but on wake we want to detect
// a wedged connection without waiting up to a full ping cycle.
const PROBE_TIMEOUT_MS = 5_000;
const ALL_TOKENS_KEY = "__all__";
const GLOBAL_CHANNELS = new Set(["newToken", "stats"]);

function subjectKey(channel: string, token: string | undefined): string {
  if (GLOBAL_CHANNELS.has(channel) || !token) return `${channel}:${ALL_TOKENS_KEY}`;
  return `${channel}:${token.toLowerCase()}`;
}

/**
 * Unthrottled keep-alive ticker.
 *
 * Browsers throttle main-thread `setInterval` / `setTimeout` in background
 * tabs (Chrome's "intensive throttling" caps them at one tick per minute
 * after ~5 minutes hidden). A 30 s WS ping built on `setInterval` therefore
 * silently misses its cadence in a backgrounded Alt Fun tab — the connection
 * goes idle, the CF edge / NAT / server eventually drops it, and the user
 * comes back to a frozen chart that may take a long retry-backoff cycle to
 * recover (or never, if the close event was lost to an OS-level half-open).
 *
 * Web Workers run their own event loop and are **not** subject to background
 * tab throttling, so a tiny dedicated worker can tick at the intended 30 s
 * cadence regardless of tab visibility. The main thread receives each tick
 * via `postMessage` and fans it out to every active subscriber, which is
 * enough to keep the per-`SubjectSocket` ping/pong handshake honest.
 *
 * If the Worker constructor is unavailable (test runners with no DOM, very
 * old browsers, restrictive CSPs forbidding `blob:` workers) we fall back
 * to a main-thread `setInterval`. The fallback is throttled in background
 * tabs but is still the correct behaviour in foreground / on test runners,
 * and the visibility-change watcher (`installVisibilityWatcher`) catches
 * any wedged connections on return-to-foreground as a second line of
 * defence.
 */
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
        // Inline-blob worker keeps the keep-alive infrastructure
        // self-contained — no separate file to bundle, no extra HTTP
        // request, and no import-meta.url plumbing through Vite.
        const code = [
          'let id = null;',
          'self.addEventListener("message", (e) => {',
          '  if (!e.data) return;',
          '  if (e.data.type === "start") {',
          '    if (id !== null) clearInterval(id);',
          '    id = setInterval(() => self.postMessage("tick"), e.data.intervalMs);',
          '  } else if (e.data.type === "stop") {',
          '    if (id !== null) { clearInterval(id); id = null; }',
          '  }',
          '});',
        ].join("\n");
        const blob = new Blob([code], { type: "application/javascript" });
        this.workerObjectUrl = URL.createObjectURL(blob);
        const worker = new Worker(this.workerObjectUrl);
        worker.onmessage = () => this.tick();
        worker.onerror = () => {
          // Worker died for some reason (CSP, runtime fault). Fall back to
          // the main-thread timer so the keep-alive cadence isn't lost.
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
        // Worker construction failed (blocked blob: schemes, OOM, …).
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
        // some environments don't implement revokeObjectURL — safe to ignore
      }
      this.workerObjectUrl = null;
    }
  }

  private tick(): void {
    // Snapshot the listener set so a listener mutating the set (e.g.
    // unsubscribing because its socket just force-closed on a missed pong)
    // doesn't break the iteration mid-fan-out.
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
  private tickerUnsub: (() => void) | null = null;
  private probeTimer: ReturnType<typeof setTimeout> | null = null;
  // Two independent "awaiting pong" flags keep the 30 s regular ping cycle
  // and the short post-wake probe from clobbering each other. A wake-up
  // probe lands at an arbitrary point in the 30 s cycle; if it shared
  // `awaitingPong` with the regular cycle, the next regular tick (which
  // could land anywhere from a few ms to the full PING_INTERVAL_MS away,
  // since the ticker phase is shared across all sockets) would interpret
  // the probe's set flag as a missed pong from the previous regular cycle
  // and force-close a perfectly healthy connection. Splitting the state
  // gives each cycle its own grace window — 30 s for regular pings,
  // PROBE_TIMEOUT_MS for probes — while a server pong clears both.
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

  /**
   * Bring this subject back to a healthy state after a tab returns to the
   * foreground (`visibilitychange`) or the network comes back (`online`).
   *
   * The chart's keep-alive pings are driven by a Web Worker so they survive
   * background-tab throttling, but a hostile network path (NAT idle eviction
   * mid-background, captive-portal MITM, hung intermediate proxy) can still
   * silently kill a connection while the browser thinks `readyState` is
   * still `OPEN`. Without an explicit nudge on wake we'd wait up to a full
   * ping cycle for the next 30 s tick to notice the wedged socket. This
   * does that nudge:
   *
   *   - `OPEN` → send a probe ping with a short verification window. If
   *     the pong doesn't land within `PROBE_TIMEOUT_MS`, force-close so
   *     the existing onclose → scheduleReconnect path runs.
   *   - `CLOSING` / `CLOSED` / `null` → cancel any throttled reconnect
   *     timer (the browser may have queued it minutes deep) and reconnect
   *     immediately, resetting the backoff so the first attempt is snappy.
   *   - `CONNECTING` → leave it alone, a connect is already in flight.
   */
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

    // No pong arrived since the last ping — the socket is wedged
    // (NAT idle eviction, captive-portal MITM, hung intermediate proxy).
    // Force-close so the existing onclose → scheduleReconnect path runs;
    // browsers otherwise keep readyState=OPEN until the OS-level TCP
    // timeout, which can be 5+ minutes on long-lived sockets.
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
    // Pong arrival cancels the probe timer (`onPongReceived`); if it
    // doesn't land we force-close inside the timeout so the reconnect
    // path runs without waiting for the next 30 s ping tick.
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
    // A single server pong clears both the regular-cycle and probe-cycle
    // outstanding flags. The wire protocol carries no sequence number so
    // we can't attribute the pong to a specific ping — and we don't need
    // to: any pong means the round-trip just succeeded.
    this.awaitingPong = false;
    this.awaitingProbe = false;
    if (this.probeTimer) {
      clearTimeout(this.probeTimer);
      this.probeTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer) return;
    // Capture the current backoff for *this* timer, then advance the
    // multiplier only after the reconnect has been attempted. Without
    // this snapshot the first reconnect would use `INITIAL_RECONNECT_MS *
    // 2 = 2000ms` instead of the intended `1000ms`.
    const delay = this.reconnectMs;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
      this.reconnectMs = Math.min(this.reconnectMs * 2, MAX_RECONNECT_MS);
    }, delay);
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

  /**
   * Probe every active subject socket — used by the document-level
   * `visibilitychange` / `online` listeners installed in
   * `installLifecycleWatchers`. Snapshots the subject set so a wake-driven
   * dispose (e.g. a force-close synchronously closing the socket from a
   * concurrent unsubscribe path) can't break the iteration.
   */
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
  }
}

let instance: WebSocketClient | null = null;
let lifecycleWatchersInstalled = false;

/**
 * Wire `visibilitychange` and `online` events to `WebSocketClient.wakeAll`.
 *
 * Installed once per page load, the first time `getWebSocketClient()` is
 * called in a browser context. Idempotent — the `lifecycleWatchersInstalled`
 * guard makes repeated calls (e.g. HMR re-imports during dev) a no-op.
 *
 * Why both events:
 *   - `visibilitychange`: catches the "user tabs away → comes back" case
 *     where background-tab throttling has stretched timers far enough
 *     that the connection may have died silently. The Web Worker keep-
 *     alive ticker prevents this in normal operation, but the wake probe
 *     is the second line of defence for hostile network paths
 *     (NAT idle eviction, captive-portal MITM, hung intermediate proxy).
 *   - `online`: catches the "WiFi dropped → came back" case. Browsers
 *     fire `online` when the network stack reattaches; without this we'd
 *     wait for the OS-level TCP timeout (5+ minutes) to learn the existing
 *     socket is dead.
 */
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
