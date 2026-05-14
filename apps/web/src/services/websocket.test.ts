// @vitest-environment jsdom

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";

/**
 * The browser keep-alive ticker prefers a Web Worker (unthrottled in
 * background tabs) but falls back to a main-thread `setInterval` when
 * `Worker` / `Blob` aren't available. Tests target the fallback path so
 * `vi.useFakeTimers()` deterministically advances the cadence — jsdom's
 * Worker support is too thin to drive a blob-URL keep-alive worker, and
 * the Worker variant is just a thin wrapper around the same `setInterval`
 * semantics anyway.
 *
 * We disable the Worker path by deleting the `Worker` global before the
 * module under test reads it. `vi.resetModules()` between cases isolates
 * the module-level singleton (`instance`, `lifecycleWatchersInstalled`)
 * so each test starts from a clean slate.
 */

interface WsClientLike {
  subscribe: (
    channel: string,
    handler: (data: unknown) => void,
    token?: string,
  ) => () => void;
  wakeAll: () => void;
  onReconnect: (handler: () => void) => () => void;
  dispose: () => void;
}

interface WsClientConstructor {
  new (url: string): WsClientLike;
}

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  static instances: FakeWebSocket[] = [];

  readyState: number = FakeWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];
  url: string;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    if (
      this.readyState === FakeWebSocket.CLOSED ||
      this.readyState === FakeWebSocket.CLOSING
    ) {
      return;
    }
    this.readyState = FakeWebSocket.CLOSED;
    if (this.onclose) this.onclose();
  }

  /** Test helpers — drive the lifecycle from the suite. */
  triggerOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    if (this.onopen) this.onopen();
  }

  triggerMessage(msg: object): void {
    if (this.onmessage) this.onmessage({ data: JSON.stringify(msg) });
  }
}

function resetFakeWebSocket(): void {
  FakeWebSocket.instances = [];
}

function latestWs(): FakeWebSocket {
  const ws = FakeWebSocket.instances.at(-1);
  if (!ws) throw new Error("no FakeWebSocket has been constructed yet");
  return ws;
}

async function importClient(): Promise<WsClientConstructor> {
  const mod = await import("./websocket");
  return mod.WebSocketClient as unknown as WsClientConstructor;
}

beforeEach(() => {
  vi.useFakeTimers();
  resetFakeWebSocket();
  vi.stubGlobal("WebSocket", FakeWebSocket);
  // Force the keep-alive ticker onto its `setInterval` fallback so fake
  // timers drive the ping cadence. jsdom's Worker support is too thin to
  // run a blob-URL keep-alive worker reliably.
  vi.stubGlobal("Worker", undefined);
  vi.resetModules();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const PING_INTERVAL_MS = 30_000;
const PROBE_TIMEOUT_MS = 5_000;

describe("SubjectSocket ping/pong lifecycle", () => {
  it("opens a WebSocket to the subject's shard on first subscribe", async () => {
    const WebSocketClient = await importClient();
    const client = new WebSocketClient("wss://example.com/ws");
    client.subscribe("trade", () => {}, "0xabc");

    expect(FakeWebSocket.instances).toHaveLength(1);
    const url = new URL(latestWs().url);
    expect(url.searchParams.get("channel")).toBe("trade");
    expect(url.searchParams.get("token")).toBe("0xabc");
  });

  it("does not start pinging until the WebSocket opens", async () => {
    const WebSocketClient = await importClient();
    const client = new WebSocketClient("wss://example.com/ws");
    client.subscribe("trade", () => {});

    const ws = latestWs();
    vi.advanceTimersByTime(PING_INTERVAL_MS * 3);
    expect(ws.sent).toHaveLength(0);
  });

  it("sends a ping at the configured cadence once open", async () => {
    const WebSocketClient = await importClient();
    const client = new WebSocketClient("wss://example.com/ws");
    client.subscribe("trade", () => {});
    const ws = latestWs();
    ws.triggerOpen();

    vi.advanceTimersByTime(PING_INTERVAL_MS);
    expect(ws.sent).toHaveLength(1);
    expect(JSON.parse(ws.sent[0])).toEqual({ type: "ping" });
  });

  it("clears awaitingPong on pong receipt so the next tick can ping again", async () => {
    const WebSocketClient = await importClient();
    const client = new WebSocketClient("wss://example.com/ws");
    client.subscribe("trade", () => {});
    const ws = latestWs();
    ws.triggerOpen();

    vi.advanceTimersByTime(PING_INTERVAL_MS);
    expect(ws.sent).toHaveLength(1);
    ws.triggerMessage({ type: "pong" });

    vi.advanceTimersByTime(PING_INTERVAL_MS);
    expect(ws.sent).toHaveLength(2);
    expect(ws.readyState).toBe(FakeWebSocket.OPEN);
  });

  it("force-closes a wedged connection when a pong is missed", async () => {
    const WebSocketClient = await importClient();
    const client = new WebSocketClient("wss://example.com/ws");
    client.subscribe("trade", () => {});
    const ws = latestWs();
    ws.triggerOpen();

    vi.advanceTimersByTime(PING_INTERVAL_MS);
    expect(ws.sent).toHaveLength(1);

    vi.advanceTimersByTime(PING_INTERVAL_MS);
    expect(ws.readyState).toBe(FakeWebSocket.CLOSED);
  });

  it("mirrors a server-initiated ping back as a pong", async () => {
    const WebSocketClient = await importClient();
    const client = new WebSocketClient("wss://example.com/ws");
    client.subscribe("trade", () => {});
    const ws = latestWs();
    ws.triggerOpen();

    ws.triggerMessage({ type: "ping" });
    expect(ws.sent).toHaveLength(1);
    expect(JSON.parse(ws.sent[0])).toEqual({ type: "pong" });
  });

  it("delivers channel payloads to every subscriber for the subject", async () => {
    const WebSocketClient = await importClient();
    const client = new WebSocketClient("wss://example.com/ws");
    const handlerA = vi.fn();
    const handlerB = vi.fn();
    client.subscribe("trade", handlerA, "0xabc");
    client.subscribe("trade", handlerB, "0xabc");

    const ws = latestWs();
    ws.triggerOpen();
    ws.triggerMessage({ channel: "trade", data: { id: "1" } });

    expect(handlerA).toHaveBeenCalledWith({ id: "1" });
    expect(handlerB).toHaveBeenCalledWith({ id: "1" });
  });
});

describe("wakeAll — visibility / online recovery", () => {
  it("sends a probe ping on an OPEN socket", async () => {
    const WebSocketClient = await importClient();
    const client = new WebSocketClient("wss://example.com/ws");
    client.subscribe("trade", () => {});
    const ws = latestWs();
    ws.triggerOpen();
    ws.sent.length = 0;

    client.wakeAll();
    expect(ws.sent).toHaveLength(1);
    expect(JSON.parse(ws.sent[0])).toEqual({ type: "ping" });
  });

  it("force-closes an OPEN socket whose probe pong never arrives within the timeout", async () => {
    const WebSocketClient = await importClient();
    const client = new WebSocketClient("wss://example.com/ws");
    client.subscribe("trade", () => {});
    const ws = latestWs();
    ws.triggerOpen();

    client.wakeAll();
    expect(ws.readyState).toBe(FakeWebSocket.OPEN);

    vi.advanceTimersByTime(PROBE_TIMEOUT_MS);
    expect(ws.readyState).toBe(FakeWebSocket.CLOSED);
  });

  it("clears the probe-close timer when the pong arrives in time", async () => {
    const WebSocketClient = await importClient();
    const client = new WebSocketClient("wss://example.com/ws");
    client.subscribe("trade", () => {});
    const ws = latestWs();
    ws.triggerOpen();

    client.wakeAll();
    ws.triggerMessage({ type: "pong" });

    vi.advanceTimersByTime(PROBE_TIMEOUT_MS * 2);
    expect(ws.readyState).toBe(FakeWebSocket.OPEN);
  });

  it("reconnects a CLOSED socket immediately rather than waiting for backoff", async () => {
    const WebSocketClient = await importClient();
    const client = new WebSocketClient("wss://example.com/ws");
    client.subscribe("trade", () => {});
    const ws1 = latestWs();
    ws1.triggerOpen();
    ws1.close();

    // Reconnect is scheduled by `onclose` but not yet fired (initial 1 s
    // backoff). `wakeAll` should cancel that timer and reconnect now.
    expect(FakeWebSocket.instances).toHaveLength(1);

    client.wakeAll();
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it("cancels a long-throttled reconnect timer and resets backoff on wake", async () => {
    const WebSocketClient = await importClient();
    const client = new WebSocketClient("wss://example.com/ws");
    client.subscribe("trade", () => {});

    // Walk the backoff up to near the cap by simulating repeated drops:
    // each close schedules a reconnect, each reconnect doubles the backoff.
    for (let i = 0; i < 5; i++) {
      const ws = latestWs();
      ws.triggerOpen();
      ws.close();
      // Run the scheduled reconnect so the next backoff bumps.
      vi.runOnlyPendingTimers();
    }
    const beforeWakeCount = FakeWebSocket.instances.length;

    // A fresh close lands us in backoff. Wake should cancel it and reconnect
    // immediately rather than waiting up to MAX_RECONNECT_MS (30 s).
    latestWs().close();
    client.wakeAll();

    expect(FakeWebSocket.instances.length).toBeGreaterThan(beforeWakeCount);
  });

  it("touches every active subject on a single wake call", async () => {
    const WebSocketClient = await importClient();
    const client = new WebSocketClient("wss://example.com/ws");
    client.subscribe("trade", () => {}, "0xaaa");
    client.subscribe("price", () => {}, "0xbbb");
    expect(FakeWebSocket.instances).toHaveLength(2);

    const [a, b] = FakeWebSocket.instances;
    a.triggerOpen();
    b.triggerOpen();
    a.sent.length = 0;
    b.sent.length = 0;

    client.wakeAll();
    expect(a.sent).toHaveLength(1);
    expect(b.sent).toHaveLength(1);
  });

  it("is a no-op for sockets still in CONNECTING (no probe, no extra reconnect)", async () => {
    const WebSocketClient = await importClient();
    const client = new WebSocketClient("wss://example.com/ws");
    client.subscribe("trade", () => {});
    const ws = latestWs();
    expect(ws.readyState).toBe(FakeWebSocket.CONNECTING);

    client.wakeAll();
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(ws.sent).toHaveLength(0);
  });

  // Regression: a wake-up probe and a regular 30 s ping tick share the
  // same `ws.send({ type: "ping" })` envelope, but they must NOT share
  // the same outstanding-pong bookkeeping. If both used a single
  // `awaitingPong` flag, a regular tick landing mid-probe-window would
  // see the probe's `awaitingPong=true`, mistake it for a missed pong
  // from the previous regular cycle, and force-close a perfectly healthy
  // connection. The flags are split (`awaitingPong` for regular, an
  // independent `awaitingProbe` for wake probes) and any pong clears
  // both — this test pins that down.
  it("a regular tick mid-probe-window does not close a healthy connection", async () => {
    const WebSocketClient = await importClient();
    const client = new WebSocketClient("wss://example.com/ws");
    client.subscribe("trade", () => {});
    const ws = latestWs();
    ws.triggerOpen();
    ws.sent.length = 0;

    // Land the wake probe just before the regular tick would naturally
    // fire. The regular tick must not interpret the probe's outstanding
    // state as a missed pong and close the socket.
    vi.advanceTimersByTime(PING_INTERVAL_MS - 2_000);
    client.wakeAll();
    expect(ws.sent).toHaveLength(1);

    vi.advanceTimersByTime(2_000);
    expect(ws.readyState).toBe(FakeWebSocket.OPEN);
    expect(ws.sent).toHaveLength(2);

    // Pong clears both the probe and the regular cycle's outstanding
    // state — the next tick must be able to ping again.
    ws.triggerMessage({ type: "pong" });

    vi.advanceTimersByTime(PING_INTERVAL_MS);
    expect(ws.readyState).toBe(FakeWebSocket.OPEN);
    expect(ws.sent.length).toBeGreaterThanOrEqual(3);
  });
});

describe("document/window lifecycle watchers (getWebSocketClient)", () => {
  // The lifecycle-watcher install path is reached only through the
  // singleton helper. We need to inject `import.meta.env.VITE_WS_URL`
  // for the singleton to construct an instance.
  beforeEach(() => {
    vi.stubEnv("VITE_WS_URL", "wss://example.com/ws");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("registers visibility and online listeners on first client creation", async () => {
    const docSpy = vi.spyOn(document, "addEventListener");
    const winSpy = vi.spyOn(window, "addEventListener");

    const mod = await import("./websocket");
    const client = mod.getWebSocketClient();
    expect(client).not.toBeNull();

    const docEvents = (docSpy.mock.calls as [string, unknown][]).map(
      (call) => call[0],
    );
    const winEvents = (winSpy.mock.calls as [string, unknown][]).map(
      (call) => call[0],
    );
    expect(docEvents).toContain("visibilitychange");
    expect(winEvents).toContain("online");

    docSpy.mockRestore();
    winSpy.mockRestore();
  });

  it("wakes every subject when the tab becomes visible", async () => {
    const mod = await import("./websocket");
    const client = mod.getWebSocketClient();
    expect(client).not.toBeNull();
    if (!client) return;
    client.subscribe("trade", () => {});
    const ws = latestWs();
    ws.triggerOpen();
    ws.sent.length = 0;

    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));

    expect(ws.sent).toHaveLength(1);
    expect(JSON.parse(ws.sent[0])).toEqual({ type: "ping" });
  });

  it("does not wake on visibilitychange while the tab is still hidden", async () => {
    const mod = await import("./websocket");
    const client = mod.getWebSocketClient();
    expect(client).not.toBeNull();
    if (!client) return;
    client.subscribe("trade", () => {});
    const ws = latestWs();
    ws.triggerOpen();
    ws.sent.length = 0;

    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));

    expect(ws.sent).toHaveLength(0);
  });

  it("wakes every subject when the network comes back online", async () => {
    const mod = await import("./websocket");
    const client = mod.getWebSocketClient();
    expect(client).not.toBeNull();
    if (!client) return;
    client.subscribe("trade", () => {});
    const ws = latestWs();
    ws.triggerOpen();
    ws.sent.length = 0;

    window.dispatchEvent(new Event("online"));
    expect(ws.sent).toHaveLength(1);
    expect(JSON.parse(ws.sent[0])).toEqual({ type: "ping" });
  });

  it("installs the lifecycle watchers exactly once across repeated calls", async () => {
    const docSpy: MockInstance = vi.spyOn(document, "addEventListener");

    const mod = await import("./websocket");
    mod.getWebSocketClient();
    mod.getWebSocketClient();
    mod.getWebSocketClient();

    const visibilityCalls = (docSpy.mock.calls as [string, unknown][]).filter(
      (call) => call[0] === "visibilitychange",
    );
    expect(visibilityCalls).toHaveLength(1);
    docSpy.mockRestore();
  });
});
