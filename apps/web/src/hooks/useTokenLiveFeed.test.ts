import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createTradeFeedInvalidator,
  isLiveUpdateForToken,
} from "./useTokenLiveFeed";

import type { TradeBroadcast } from "../services/types";

describe("isLiveUpdateForToken", () => {
  function tradeListVariant(tokenAddress: string): TradeBroadcast {
    return {
      id: "0xabc-1",
      tokenAddress,
      timestamp: "1700000000",
      usdcAmount: "100000000",
      tokenAmount: "1000000000000000000",
      trader: "0xtrader",
      isBuy: true,
    };
  }

  function chartStateVariant(tokenAddress: string): TradeBroadcast {
    return {
      id: "0xabc-2",
      tokenAddress,
      timestamp: "1700000000",
      curveSupply: "999000000000000000000000000",
      ltReserve: "5000000000000000000",
    };
  }

  // Trade-list and chart-state variants both signal that curve state
  // moved — see `apps/web/src/hooks/useTokenLiveFeed.ts` JSDoc. The
  // predicate is variant-blind by design.
  it("accepts both broadcast variants on the trade channel", () => {
    expect(isLiveUpdateForToken(tradeListVariant("0xabc"), "0xabc")).toBe(true);
    expect(isLiveUpdateForToken(chartStateVariant("0xabc"), "0xabc")).toBe(true);
  });

  // The WS subject shard already segregates traffic per-token, but the
  // hook still gates on the payload field defensively. Address comparison
  // is case-folded because the indexer normalises to lowercase while
  // EVM-style mixed-case addresses are common in client routes.
  it("matches case-insensitively against the normalized address", () => {
    expect(
      isLiveUpdateForToken(tradeListVariant("0xABCDEF"), "0xabcdef"),
    ).toBe(true);
  });

  it("rejects broadcasts for a different token", () => {
    expect(isLiveUpdateForToken(tradeListVariant("0xdead"), "0xabcdef")).toBe(
      false,
    );
  });

  // `tokenAddress` is typed `string` on `TradeBroadcastBase`, but the WS
  // server could in principle send a malformed payload — the optional
  // chaining guards against a thrown `TypeError` from `.toLowerCase()`
  // on `undefined`.
  it("rejects broadcasts missing tokenAddress", () => {
    const broken: Partial<TradeBroadcast> = { ...tradeListVariant("0x") };
    delete broken.tokenAddress;
    expect(isLiveUpdateForToken(broken as TradeBroadcast, "0xabcdef")).toBe(
      false,
    );
  });

  // Primitive payloads (a stray string / number sent on the wire) are
  // safe under optional chaining — accessing `.tokenAddress` on them
  // returns `undefined` and falls through. Documented here so the
  // hook-level `typeof data !== "object"` guard doesn't accidentally
  // tighten the predicate over time and start rejecting traffic that
  // would otherwise just no-op.
  it("rejects primitive payloads without throwing", () => {
    expect(
      isLiveUpdateForToken("not a broadcast" as unknown as TradeBroadcast, "0xabcdef"),
    ).toBe(false);
  });
});

describe("createTradeFeedInvalidator", () => {
  // Typed as the call signature `createTradeFeedInvalidator` expects so
  // vitest 4's stricter `Mock` typing doesn't poison the parameter
  // inference. The cast is one-way: we still read `.mock.calls` etc. via
  // the original `vi.fn()` handle below.
  let invalidateMock: ReturnType<typeof vi.fn>;
  let invalidate: () => void;
  let currentTime: number;
  const now = () => currentTime;

  beforeEach(() => {
    vi.useFakeTimers();
    invalidateMock = vi.fn();
    invalidate = invalidateMock as unknown as () => void;
    currentTime = 1_000_000;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Leading edge: a single trade after a quiet period fires straight
  // away. This is the bit that makes the strip feel "live" rather than
  // "delayed by N ms" for the common single-trade case.
  it("fires immediately on the first event (leading edge)", () => {
    const inv = createTradeFeedInvalidator(invalidate, 1_000, now);

    inv.handle();

    expect(invalidateMock).toHaveBeenCalledTimes(1);
  });

  // Subsequent events inside the window must NOT chain refetches —
  // that's the entire point of the throttle. They schedule the trailing
  // fire instead (covered below).
  it("does not fire again inside the throttle window", () => {
    const inv = createTradeFeedInvalidator(invalidate, 1_000, now);

    inv.handle();
    currentTime += 100;
    inv.handle();
    currentTime += 200;
    inv.handle();

    expect(invalidateMock).toHaveBeenCalledTimes(1);
  });

  // Trailing edge: the latest event in a burst must always land. Without
  // this, a flurry of buys ending at t=500ms inside a 1000ms window
  // would leave the user staring at the pre-burst state until the next
  // trade — defeats "live".
  it("fires a trailing edge once the window closes", () => {
    const inv = createTradeFeedInvalidator(invalidate, 1_000, now);

    inv.handle();
    currentTime += 200;
    inv.handle();

    currentTime += 800;
    vi.advanceTimersByTime(800);

    expect(invalidateMock).toHaveBeenCalledTimes(2);
  });

  // Coalescing: multiple in-window events must collapse to exactly one
  // trailing fire (not one-per-event). 10 trades in 100ms should produce
  // 2 invalidations total: leading + trailing.
  it("coalesces multiple in-window events into one trailing fire", () => {
    const inv = createTradeFeedInvalidator(invalidate, 1_000, now);

    inv.handle();
    for (let i = 0; i < 10; i++) {
      currentTime += 50;
      inv.handle();
    }

    currentTime += 500;
    vi.advanceTimersByTime(1_000);

    expect(invalidateMock).toHaveBeenCalledTimes(2);
  });

  // After the trailing fire lands, the throttle must reset so the very
  // next event after the window is treated as leading-edge again
  // (snappy). Otherwise we'd be stuck waiting for another trailing
  // every time, doubling perceived latency on intermittent trading.
  it("resets to leading-edge after the trailing fires", () => {
    const inv = createTradeFeedInvalidator(invalidate, 1_000, now);

    inv.handle();
    currentTime += 200;
    inv.handle();
    currentTime += 800;
    vi.advanceTimersByTime(800);
    expect(invalidateMock).toHaveBeenCalledTimes(2);

    currentTime += 5_000;
    inv.handle();

    expect(invalidateMock).toHaveBeenCalledTimes(3);
  });

  // `dispose` is called on unsubscribe (address change, unmount). A
  // pending trailing timer would otherwise fire after the React effect
  // has torn down, invalidating a query for a token the user is no
  // longer viewing.
  it("dispose cancels a pending trailing fire", () => {
    const inv = createTradeFeedInvalidator(invalidate, 1_000, now);

    inv.handle();
    currentTime += 200;
    inv.handle();
    inv.dispose();

    currentTime += 5_000;
    vi.advanceTimersByTime(5_000);

    expect(invalidateMock).toHaveBeenCalledTimes(1);
  });
});
