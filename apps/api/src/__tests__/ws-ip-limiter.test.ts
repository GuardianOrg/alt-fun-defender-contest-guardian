import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    ctx: DurableObjectState;
    env: unknown;
    constructor(ctx: DurableObjectState, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

const { WsIpLimiter, MAX_CONNECTIONS_PER_IP, tryAcquireIpSlot, releaseIpSlot } =
  await import("../websocket/ip-limiter.js");

/** Per-slot TTL hard-coded in the module; kept in sync with the SLOT_TTL_MS constant. */
const SLOT_TTL_MS = 30 * 60_000;

function makeLimiter() {
  const ctx = {} as DurableObjectState;
  return new WsIpLimiter(ctx, {} as unknown as ConstructorParameters<typeof WsIpLimiter>[1]);
}

async function call(
  limiter: InstanceType<typeof WsIpLimiter>,
  path: string,
  body: unknown = {},
) {
  const res = await limiter.fetch(
    new Request(`https://internal${path}`, {
      method: path === "/debug" ? "GET" : "POST",
      headers: { "Content-Type": "application/json" },
      body: path === "/debug" ? undefined : JSON.stringify(body),
    }),
  );
  return (await res.json()) as {
    ok?: boolean;
    count?: number;
    limit?: number;
    counts?: Record<string, number>;
  };
}

describe("WsIpLimiter acquire/release", () => {
  it("admits up to MAX_CONNECTIONS_PER_IP", async () => {
    const limiter = makeLimiter();
    for (let i = 0; i < MAX_CONNECTIONS_PER_IP; i++) {
      const r = await call(limiter, "/acquire", { ip: "1.1.1.1" });
      expect(r.ok).toBe(true);
      expect(r.count).toBe(i + 1);
    }
  });

  it("rejects when an IP is at the limit", async () => {
    const limiter = makeLimiter();
    for (let i = 0; i < MAX_CONNECTIONS_PER_IP; i++) {
      await call(limiter, "/acquire", { ip: "1.1.1.1" });
    }
    const r = await call(limiter, "/acquire", { ip: "1.1.1.1" });
    expect(r.ok).toBe(false);
    expect(r.count).toBe(MAX_CONNECTIONS_PER_IP);
    expect(r.limit).toBe(MAX_CONNECTIONS_PER_IP);
  });

  it("treats different IPs independently", async () => {
    const limiter = makeLimiter();
    for (let i = 0; i < MAX_CONNECTIONS_PER_IP; i++) {
      await call(limiter, "/acquire", { ip: "1.1.1.1" });
    }
    const r = await call(limiter, "/acquire", { ip: "2.2.2.2" });
    expect(r.ok).toBe(true);
  });

  it("releases a slot back to the pool", async () => {
    const limiter = makeLimiter();
    for (let i = 0; i < MAX_CONNECTIONS_PER_IP; i++) {
      await call(limiter, "/acquire", { ip: "1.1.1.1" });
    }
    await call(limiter, "/release", { ip: "1.1.1.1" });
    const r = await call(limiter, "/acquire", { ip: "1.1.1.1" });
    expect(r.ok).toBe(true);
  });

  it("floors release at zero (idempotent on missed acquire)", async () => {
    const limiter = makeLimiter();
    await call(limiter, "/release", { ip: "1.1.1.1" });
    await call(limiter, "/release", { ip: "1.1.1.1" });
    const r = await call(limiter, "/acquire", { ip: "1.1.1.1" });
    expect(r.ok).toBe(true);
    expect(r.count).toBe(1);
  });
});

describe("WsIpLimiter slot TTL — leaked-slot recovery", () => {
  // Anchor the clock so we can advance past the per-slot TTL deterministically.
  // Real-world leak scenario: a webSocketClose / TCP-reset path drops the
  // release call, so the count never ticks down — without the TTL backstop
  // the shared-IP stays at the cap forever and every new connection 429s.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("ages out expired slots on the next acquire so the IP can reconnect", async () => {
    const limiter = makeLimiter();
    // Saturate the per-IP cap.
    for (let i = 0; i < MAX_CONNECTIONS_PER_IP; i++) {
      await call(limiter, "/acquire", { ip: "1.1.1.1" });
    }
    // Confirm we're capped right at the boundary.
    const rejected = await call(limiter, "/acquire", { ip: "1.1.1.1" });
    expect(rejected.ok).toBe(false);

    // Advance past the per-slot TTL. The slots we just acquired are now
    // "stale" from the limiter's perspective (real connections would have
    // closed cleanly long before this, so a slot still alive at this age
    // is a leak by definition).
    vi.advanceTimersByTime(SLOT_TTL_MS + 1);

    // The next acquire prunes the expired slots before checking the cap,
    // so the IP gets a fresh slot at count 1 — the leak no longer
    // permanently blocks them.
    const recovered = await call(limiter, "/acquire", { ip: "1.1.1.1" });
    expect(recovered.ok).toBe(true);
    expect(recovered.count).toBe(1);
  });

  it("debug endpoint reports live (post-prune) counts, not stale leaked counts", async () => {
    const limiter = makeLimiter();
    for (let i = 0; i < MAX_CONNECTIONS_PER_IP; i++) {
      await call(limiter, "/acquire", { ip: "1.1.1.1" });
    }

    // Without the post-prune in `/debug`, an operator probing the
    // limiter to investigate a 429 cluster would see "1.1.1.1: 50" and
    // assume the IP genuinely has 50 active connections. The TTL is
    // there precisely to disclaim that — the debug surface needs to
    // reflect what the next acquire would see.
    vi.advanceTimersByTime(SLOT_TTL_MS + 1);

    const debug = await call(limiter, "/debug", undefined);
    expect(debug.counts?.["1.1.1.1"]).toBe(0);
  });

  it("does not reap slots that are still within the TTL window", async () => {
    const limiter = makeLimiter();
    for (let i = 0; i < MAX_CONNECTIONS_PER_IP; i++) {
      await call(limiter, "/acquire", { ip: "1.1.1.1" });
    }

    // Just under the TTL — legitimate long-lived connections must NOT be
    // reaped here. The 30-min ceiling is deliberately well above the
    // server-side idle-ping cycle (~90s) so an active connection that
    // does its own clean close never collides with the safety net.
    vi.advanceTimersByTime(SLOT_TTL_MS - 1);

    const r = await call(limiter, "/acquire", { ip: "1.1.1.1" });
    expect(r.ok).toBe(false);
    expect(r.count).toBe(MAX_CONNECTIONS_PER_IP);
  });
});

describe("tryAcquireIpSlot / releaseIpSlot helpers", () => {
  it("forwards to /acquire and /release on the limiter DO", async () => {
    const fetched: string[] = [];
    const stub = {
      fetch: vi.fn(async (url: string) => {
        fetched.push(new URL(url).pathname);
        return new Response(JSON.stringify({ ok: true, count: 1 }), {
          status: 200,
        });
      }),
    };
    const ns = {
      idFromName: vi.fn(() => "id"),
      get: vi.fn(() => stub),
    } as unknown as DurableObjectNamespace;

    await tryAcquireIpSlot(ns, "1.1.1.1");
    await releaseIpSlot(ns, "1.1.1.1");

    expect(ns.idFromName).toHaveBeenCalledWith("ws-ip-limiter");
    expect(fetched).toEqual(["/acquire", "/release"]);
  });

  it("swallows errors in releaseIpSlot (true fire-and-forget)", async () => {
    const ns = {
      idFromName: vi.fn(() => "id"),
      get: vi.fn(() => ({
        fetch: vi.fn(async () => {
          throw new Error("limiter unreachable");
        }),
      })),
    } as unknown as DurableObjectNamespace;

    // Must not throw — callers wire this into webSocketClose / waitUntil
    // and a transient limiter-DO failure should never bubble out.
    await expect(releaseIpSlot(ns, "1.1.1.1")).resolves.toBeUndefined();
  });
});
