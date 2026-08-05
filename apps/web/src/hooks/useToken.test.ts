import { describe, expect, it } from "vitest";

import { tokenRefetchInterval } from "./useToken";

import type { Token } from "../services/types";

const baseToken: Token = {
  address: "0xabc",
  name: "Test",
  ticker: "TEST",
  emoji: "",
  description: "",
  direction: "long",
  underlying: "HYPE",
  leverage: 2,
  ltName: "HYPE 2× Long",
  ltAddress: "0xdef",
  buyMomentum: 0,
  leverageBoost: 0,
  organicFilled: null,
  curveFilled: null,
  curveRaisedUsd: null,
  volume24h: null,
  totalVolumeUsd: null,
  athUsd: 0,
  priceUsd: null,
  mcapUsd: null,
  change24h: null,
  status: "active",
  creatorAddress: "0xfeed",
  communityTakeoverAt: null,
  createdAt: "2025-01-01T00:00:00Z",
  isHidden: false,
};

describe("tokenRefetchInterval", () => {
  // Active tokens stay on the WebSocket-driven invalidation path; the poll
  // is reserved for the contract-frozen graduating window where a missed
  // broadcast would otherwise hang the UI on the spinner forever
  // (issue #600).
  it("does not poll while the token is on the bonding curve", () => {
    expect(tokenRefetchInterval({ ...baseToken, status: "active" })).toBe(false);
  });

  // Polls only during the graduating window. Cadence is the safety-net
  // floor; the WS broadcast is still the primary signal — see the JSDoc on
  // `useToken` for the exhaustive list of failure modes this guards
  // against.
  it("polls every 3 seconds while the token is graduating", () => {
    expect(tokenRefetchInterval({ ...baseToken, status: "graduating" })).toBe(
      3_000,
    );
  });

  // Once graduation completes the WS broadcast (or the next poll while
  // graduating) flips status to "graduated" and the safety-net poll must
  // stop — otherwise every open token tab would silently keep firing
  // `/tokens/:addr` requests for the lifetime of the session.
  it("stops polling once the token has graduated", () => {
    expect(tokenRefetchInterval({ ...baseToken, status: "graduated" })).toBe(
      false,
    );
  });

  // Initial render before the first fetch resolves: data is undefined.
  // Defaulting to "no poll" matches the active-curve case (the WS path is
  // sufficient for the normal flow) and avoids burning an extra request
  // for every token detail page mount.
  it("does not poll while the first fetch is in flight (data undefined)", () => {
    expect(tokenRefetchInterval(undefined)).toBe(false);
  });
});
