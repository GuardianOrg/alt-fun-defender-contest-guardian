import { describe, expect, it, vi } from "vitest";

import { HyperliquidCandleStreamHub } from "./candleStreamHub";

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  static CONNECTING = 0;

  static OPEN = 1;

  url: string;

  readyState = MockWebSocket.CONNECTING;

  onopen: (() => void) | null = null;

  onmessage: ((ev: MessageEvent) => void) | null = null;

  onclose: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.();
    });
  }

  send = vi.fn();

  close = vi.fn(() => {
    this.readyState = MockWebSocket.CONNECTING;
    this.onclose?.();
  });

  emit(msg: object) {
    this.onmessage?.({ data: JSON.stringify(msg) } as MessageEvent);
  }
}

describe("HyperliquidCandleStreamHub", () => {
  it("opens a single socket when two listeners subscribe to the same stream", async () => {
    MockWebSocket.instances = [];
    const hub = new HyperliquidCandleStreamHub({
      WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
      subscribeVisibility: () => () => {},
    });

    const tickA = vi.fn();
    const tickB = vi.fn();
    const reset = vi.fn();

    hub.addListener("guid-a", "BTC", "1h", {
      onTick: tickA,
      onResetCacheNeededCallback: reset,
    });
    hub.addListener("guid-b", "BTC", "1h", {
      onTick: tickB,
      onResetCacheNeededCallback: reset,
    });

    await vi.waitFor(
      () => {
        expect(MockWebSocket.instances).toHaveLength(1);
      },
      { timeout: 50 },
    );

    const ws = MockWebSocket.instances[0]!;
    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({
        method: "subscribe",
        subscription: { type: "candle", coin: "BTC", interval: "1h" },
      }),
    );

    ws.emit({
      channel: "candle",
      data: { t: 5, o: "1", h: "2", l: "0.5", c: "1.5" },
    });

    expect(tickA).toHaveBeenCalledTimes(1);
    expect(tickB).toHaveBeenCalledTimes(1);

    hub.dispose();
  });

  it("closes the socket when all listeners unsubscribe", async () => {
    MockWebSocket.instances = [];
    const hub = new HyperliquidCandleStreamHub({
      WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
      subscribeVisibility: () => () => {},
    });

    hub.addListener("one", "ETH", "5m", {
      onTick: vi.fn(),
      onResetCacheNeededCallback: vi.fn(),
    });

    await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));

    hub.removeListener("one");

    expect(MockWebSocket.instances[0]!.close).toHaveBeenCalled();

    hub.dispose();
  });

  it("drops existing listeners and opens a fresh socket when stream switches without prior unsubscribe", async () => {
    MockWebSocket.instances = [];
    const hub = new HyperliquidCandleStreamHub({
      WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
      subscribeVisibility: () => () => {},
    });

    const oldTick = vi.fn();
    hub.addListener("old", "BTC", "1m", {
      onTick: oldTick,
      onResetCacheNeededCallback: vi.fn(),
    });
    await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const firstWs = MockWebSocket.instances[0]!;

    // Subscribe to a different stream without first unsubscribing.
    const newTick = vi.fn();
    hub.addListener("new", "ETH", "5m", {
      onTick: newTick,
      onResetCacheNeededCallback: vi.fn(),
    });

    // Old socket should have been closed.
    expect(firstWs.close).toHaveBeenCalled();

    // A tick on the new stream should only reach the new listener.
    await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(2));
    const secondWs = MockWebSocket.instances[1]!;
    await vi.waitFor(() => expect(secondWs.send).toHaveBeenCalled());

    secondWs.emit({
      channel: "candle",
      data: { t: 5, o: "1", h: "2", l: "0.5", c: "1.5" },
    });

    expect(newTick).toHaveBeenCalledTimes(1);
    expect(oldTick).not.toHaveBeenCalled();

    hub.dispose();
  });

  it("reopens a socket when the connection drops while listeners still exist", async () => {
    MockWebSocket.instances = [];
    const hub = new HyperliquidCandleStreamHub({
      WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
      subscribeVisibility: () => () => {},
    });

    const tick = vi.fn();
    hub.addListener("guid-1", "BTC", "1m", {
      onTick: tick,
      onResetCacheNeededCallback: vi.fn(),
    });

    await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const first = MockWebSocket.instances[0]!;
    await vi.waitFor(() => expect(first.send).toHaveBeenCalled());

    first.close();

    await vi.waitFor(() => expect(MockWebSocket.instances.length).toBeGreaterThanOrEqual(2));
    const second = MockWebSocket.instances.at(-1)!;
    await vi.waitFor(() => expect(second.send).toHaveBeenCalled());

    second.emit({
      channel: "candle",
      data: { t: 99, o: "1", h: "2", l: "0.5", c: "1.75" },
    });
    expect(tick).toHaveBeenCalledWith(
      expect.objectContaining({ close: 1.75 }),
    );

    hub.dispose();
  });

  it("after unsubscribe, a new coin opens a fresh socket", async () => {
    MockWebSocket.instances = [];
    const hub = new HyperliquidCandleStreamHub({
      WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
      subscribeVisibility: () => () => {},
    });

    hub.addListener("a", "BTC", "1m", {
      onTick: vi.fn(),
      onResetCacheNeededCallback: vi.fn(),
    });
    await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const first = MockWebSocket.instances[0]!;

    hub.removeListener("a");

    hub.addListener("b", "SOL", "1m", {
      onTick: vi.fn(),
      onResetCacheNeededCallback: vi.fn(),
    });

    await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(2));
    const second = MockWebSocket.instances[1]!;
    expect(first.close).toHaveBeenCalled();
    await vi.waitFor(() => expect(second.send).toHaveBeenCalled());
    expect(second.send).toHaveBeenCalledWith(
      expect.stringContaining('"coin":"SOL"'),
    );

    hub.dispose();
  });
});
