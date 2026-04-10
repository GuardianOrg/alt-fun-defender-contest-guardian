import { rawHyperliquidCandleToTradingViewBar } from "./rawCandleToTradingViewBar";

import type { HyperliquidCandleInterval } from "./hyperliquidCandleIntervals";
import type { SubscribeBarsCallback } from "../../../../public/charting_library/datafeed-api";

const HL_WS_URL = "wss://api.hyperliquid.xyz/ws";

export type CandleStreamListener = {
  onTick: SubscribeBarsCallback;
  onResetCacheNeededCallback: () => void;
};

export type CandleStreamHubOptions = {
  WebSocketImpl: typeof WebSocket;
  /**
   * Subscribe to browser visibility. Defaults to `document.visibilitychange`.
   * Inject in tests to avoid DOM.
   */
  subscribeVisibility?: (handler: () => void) => () => void;
};

function defaultSubscribeVisibility(handler: () => void): () => void {
  const wrapped = () => handler();
  if (typeof document === "undefined") return () => {};
  document.addEventListener("visibilitychange", wrapped);
  return () => document.removeEventListener("visibilitychange", wrapped);
}

/**
 * One Hyperliquid WS subscription (single `coin` + `interval`), many TradingView `subscribeBars` listeners.
 *
 * **Tab visibility:** we keep the socket open when the browser tab is hidden. Closing it and calling
 * `onResetCacheNeededCallback` on focus can make TradingView `unsubscribeBars` synchronously, leaving no
 * listeners before we reconnect — so the live stream and head price (`onRealtimeBar`) never resume.
 * On focus we only `ensureSocket()` so dropped connections (browser/network) reconnect.
 *
 * **Abnormal disconnect:** if the socket closes while still subscribed, we open a new one on a microtask.
 */
export class HyperliquidCandleStreamHub {
  private readonly WebSocketImpl: typeof WebSocket;

  private readonly subscribeVisibility: (handler: () => void) => () => void;

  private unsubscribeVisibility: (() => void) | null = null;

  private stream: { coin: string; interval: HyperliquidCandleInterval } | null =
    null;

  private ws: WebSocket | null = null;

  private connectionId = 0;

  private readonly listeners = new Map<string, CandleStreamListener>();

  constructor(options: CandleStreamHubOptions) {
    this.WebSocketImpl = options.WebSocketImpl;
    this.subscribeVisibility =
      options.subscribeVisibility ?? defaultSubscribeVisibility;
  }

  /**
   * The Charting Library calls `unsubscribeBars` before changing symbol or resolution, so at most
   * one `(coin, interval)` stream should be active per hub in normal use.
   */
  addListener(
    listenerGuid: string,
    coin: string,
    interval: HyperliquidCandleInterval,
    listener: CandleStreamListener,
  ): void {
    const next = { coin, interval };
    if (!this.stream) {
      this.stream = next;
    } else if (this.stream.coin !== coin || this.stream.interval !== interval) {
      // Stream is changing: drop existing listeners to avoid cross-stream delivery.
      this.listeners.clear();
      this.closeSocket();
      this.stream = next;
    }

    this.listeners.set(listenerGuid, listener);

    if (!this.unsubscribeVisibility) {
      this.unsubscribeVisibility = this.subscribeVisibility(() =>
        this.handleVisibilityChange(),
      );
    }

    this.ensureSocket();
  }

  removeListener(listenerGuid: string): void {
    this.listeners.delete(listenerGuid);
    if (this.listeners.size === 0) {
      this.teardownIdle();
    }
  }

  dispose(): void {
    this.teardownIdle();
  }

  private handleVisibilityChange(): void {
    if (typeof document === "undefined") return;
    if (document.visibilityState === "hidden") return;
    this.ensureSocket();
  }

  private ensureSocket(): void {
    if (!this.stream || this.listeners.size === 0) return;
    if (this.ws && this.ws.readyState === this.WebSocketImpl.OPEN) return;
    if (this.ws && this.ws.readyState === this.WebSocketImpl.CONNECTING) return;

    this.closeSocket();
    const { coin, interval } = this.stream;
    const ws = new this.WebSocketImpl(HL_WS_URL);
    this.ws = ws;
    this.connectionId += 1;
    const conn = this.connectionId;

    ws.onopen = () => {
      if (conn !== this.connectionId) return;
      ws.send(
        JSON.stringify({
          method: "subscribe",
          subscription: { type: "candle", coin, interval },
        }),
      );
    };

    ws.onmessage = (event: MessageEvent) => {
      if (conn !== this.connectionId) return;
      let msg: { channel?: string; data?: unknown };
      try {
        msg = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (msg.channel !== "candle" || !msg.data || typeof msg.data !== "object")
        return;

      const c = msg.data as {
        t: number;
        o: string;
        h: string;
        l: string;
        c: string;
      };

      const bar = rawHyperliquidCandleToTradingViewBar({
        t: c.t,
        o: String(c.o),
        h: String(c.h),
        l: String(c.l),
        c: String(c.c),
      });

      for (const { onTick } of this.listeners.values()) {
        onTick(bar);
      }
    };

    ws.onclose = () => {
      const openedAsConn = conn;
      if (this.ws === ws) this.ws = null;
      // Intentional shutdown: `closeSocket` already bumped `connectionId`.
      if (openedAsConn !== this.connectionId) return;
      if (this.listeners.size === 0 || !this.stream) return;
      queueMicrotask(() => {
        if (this.listeners.size === 0 || !this.stream) return;
        this.ensureSocket();
      });
    };
  }

  private closeSocket(): void {
    this.connectionId += 1;
    this.ws?.close();
    this.ws = null;
  }

  private teardownIdle(): void {
    this.closeSocket();
    this.stream = null;
    if (this.unsubscribeVisibility) {
      this.unsubscribeVisibility();
      this.unsubscribeVisibility = null;
    }
  }
}
