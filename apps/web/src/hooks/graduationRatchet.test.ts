import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetGraduationRatchetForTesting,
  applyGraduationRatchet,
  isKnownGraduated,
  markGraduated,
} from "./graduationRatchet";

import type { Token } from "../services/types";

/**
 * Minimal in-memory `Storage` polyfill. The web app's vitest config runs
 * in the default `node` environment (no jsdom), so we stub
 * `window.sessionStorage` ourselves — same pattern as
 * `vanityStorage.test.ts` / `slippageStorage.test.ts`.
 */
function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    key: (index: number) => {
      const keys = Array.from(map.keys());
      return index >= 0 && index < keys.length ? keys[index] : null;
    },
  } as Storage;
}

const baseToken: Token = {
  address: "0xAbC0000000000000000000000000000000000001",
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
  createdAt: "2025-01-01T00:00:00Z",
  isHidden: false,
};

describe("graduation ratchet", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { sessionStorage: createMemoryStorage() });
    _resetGraduationRatchetForTesting();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Sanity: a fresh module + empty storage means no addresses are known.
  // Ensures the lazy reset hook actually drops the in-memory set so other
  // tests can build up fresh expectations from zero.
  it("starts empty after reset", () => {
    expect(isKnownGraduated(baseToken.address)).toBe(false);
  });

  // The ratchet seeds itself: the first time a graduated token flows
  // through, we record it so any later degraded payload can be repaired.
  it("records the address when a graduated token passes through", () => {
    const token = { ...baseToken, status: "graduated" as const };
    const out = applyGraduationRatchet(token);
    expect(out).toBe(token);
    expect(isKnownGraduated(token.address)).toBe(true);
  });

  // Core invariant: once observed graduated, any subsequent payload that
  // claims a pre-grad lifecycle is silently pinned back to "graduated".
  // This is the bug under fix — a degraded API response un-graduating a
  // token used to flash the curve strip back to an empty bar.
  it("pins status to graduated after the address has been observed graduated", () => {
    markGraduated(baseToken.address);
    const degraded: Token = { ...baseToken, status: "active" };
    const out = applyGraduationRatchet(degraded);
    expect(out.status).toBe("graduated");
    expect(out).not.toBe(degraded);
  });

  // The ratchet must also defeat the in-between "graduating" state — a
  // degraded read might leave `graduated=false, pendingGraduation=true`
  // (the API computes `status="graduating"` from those), and we must not
  // let that walk back the post-grad UI either.
  it("pins status to graduated even when a later payload claims graduating", () => {
    markGraduated(baseToken.address);
    const stale: Token = { ...baseToken, status: "graduating" };
    const out = applyGraduationRatchet(stale);
    expect(out.status).toBe("graduated");
  });

  // No-op fast path: a token we've never observed graduated must pass
  // through untouched (same reference) so downstream `useMemo` /
  // `React.memo` short-circuits keep working.
  it("returns the same reference when the address is unknown and not graduated", () => {
    const token: Token = { ...baseToken, status: "active" };
    const out = applyGraduationRatchet(token);
    expect(out).toBe(token);
    expect(out.status).toBe("active");
  });

  // Address comparison is case-insensitive. The route param is rendered
  // as the user typed it (`getAddress` checksums with mixed case), but
  // the indexer / WS layer lowercases — so we must collide on a single
  // entry regardless of casing.
  it("normalizes addresses case-insensitively", () => {
    markGraduated("0xABC0000000000000000000000000000000000001");
    expect(isKnownGraduated("0xabc0000000000000000000000000000000000001")).toBe(
      true,
    );
    const out = applyGraduationRatchet({
      ...baseToken,
      address: "0xAbc0000000000000000000000000000000000001",
      status: "active",
    });
    expect(out.status).toBe("graduated");
  });

  // Persistence: the in-memory set is mirrored into sessionStorage so a
  // hard reload during a degraded window doesn't lose the ratchet state
  // for tokens we'd already seen graduated.
  it("persists graduated addresses to sessionStorage", () => {
    markGraduated(baseToken.address);
    const stored = window.sessionStorage.getItem(
      "altfun.graduatedRatchet.v1",
    );
    expect(stored).not.toBeNull();
    const parsed: unknown = JSON.parse(stored!);
    expect(parsed).toEqual([baseToken.address.toLowerCase()]);
  });
});

describe("graduation ratchet — module init", () => {
  // Module-scope test: when `window.sessionStorage` already contains a
  // ratchet entry at module load, the in-memory set must be hydrated
  // from it on first import. We use `vi.resetModules` to force a fresh
  // import of `graduationRatchet` against the seeded storage.
  it("hydrates from sessionStorage on first load", async () => {
    const storage = createMemoryStorage();
    storage.setItem(
      "altfun.graduatedRatchet.v1",
      JSON.stringify(["0xseed00000000000000000000000000000000beef"]),
    );
    vi.stubGlobal("window", { sessionStorage: storage });
    vi.resetModules();
    const mod = await import("./graduationRatchet");
    expect(
      mod.isKnownGraduated("0xSEED00000000000000000000000000000000BEEF"),
    ).toBe(true);
    mod._resetGraduationRatchetForTesting();
    vi.unstubAllGlobals();
  });

  // Defensive: a corrupted `sessionStorage` payload must not crash the
  // module (and therefore the entire detail page) on load. We tolerate
  // the bad value and start with an empty ratchet.
  it("ignores a malformed sessionStorage payload", async () => {
    const storage = createMemoryStorage();
    storage.setItem("altfun.graduatedRatchet.v1", "{not-json");
    vi.stubGlobal("window", { sessionStorage: storage });
    vi.resetModules();
    const mod = await import("./graduationRatchet");
    expect(
      mod.isKnownGraduated("0xseed00000000000000000000000000000000beef"),
    ).toBe(false);
    mod._resetGraduationRatchetForTesting();
    vi.unstubAllGlobals();
  });
});
