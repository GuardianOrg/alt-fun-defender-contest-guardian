import { DurableObject } from "cloudflare:workers";

/**
 * Maximum concurrent WebSocket connections allowed per IP address (global).
 *
 * Bumped from 10 in the original ship: a real token-detail tab opens ~4
 * subject shards (global `trade`, per-token `trade`, `price`, `graduation`),
 * and the home page tab opens ~3 (`trade`, `newToken`, `stats`). At 10 a
 * single user with 3 tabs sat exactly at the cap, and a reload mid-flight
 * tripped it because the old slots hadn't released yet (NAT idle timeouts,
 * abrupt-close release races). 50 leaves comfortable headroom for ~12 tabs
 * per IP while still capping outright abuse — pair this with the per-slot
 * TTL below so a leaked slot can't permanently consume capacity.
 */
export const MAX_CONNECTIONS_PER_IP = 50;

/**
 * Maximum lifetime of a single acquired slot before the periodic sweep
 * reclaims it, regardless of whether `/release` was ever called.
 *
 * This is the safety net for leaked slots — e.g. a TCP reset that never
 * delivers the WS close frame to the DO, or a `webSocketClose` handler
 * whose fire-and-forget `releaseIpSlot` call lost to a transient DO
 * unavailability. Without this, a single dropped release leaves the slot
 * stuck forever (until the limiter DO is evicted) and a real user on a
 * shared IP can hit a sticky 429 wall they can't recover from without
 * an IP rotation.
 *
 * 30 minutes is the sweet spot: long enough that a real, actively-used
 * connection (which already has 60s server-side idle pings + 30s pong
 * timeouts forcing a clean close on the WebSocketDO) never gets prematurely
 * reaped, but short enough that leak victims aren't sitting on stuck slots
 * for the full DO eviction window.
 */
const SLOT_TTL_MS = 30 * 60_000;

/**
 * Idle entries (zero live slots) are dropped from the map after this long.
 * Bounded RAM ceiling for the DO; unrelated to the per-slot TTL above —
 * this just prevents the `Map<ip, _>` from growing for the lifetime of the
 * isolate as one-off IPs cycle through.
 */
const STALE_ENTRY_TTL_MS = 5 * 60_000;

/** Sweep cadence — defines how aggressively expired slots are reclaimed. */
const SWEEP_INTERVAL_MS = 60_000;

interface IpEntry {
  /**
   * Acquisition timestamps (ms) of currently-held slots, sorted by acquire
   * time. The array length is the authoritative slot count — comparing it
   * against `MAX_CONNECTIONS_PER_IP` is the rate-limit check.
   *
   * Tracking individual timestamps (instead of a bare count) lets the sweep
   * age out slots that outlived the legitimate-connection window without
   * ever ticking the per-IP counter down to zero — the fix for the
   * "shared-IP gets stuck at the cap forever" failure mode.
   */
  slots: number[];
  /** Last time this entry was touched (acquire or release). */
  lastSeen: number;
}

/**
 * `WsIpLimiter` — single global Durable Object that tracks per-IP WebSocket
 * connection counts across the entire fleet. Lives at
 * `idFromName("ws-ip-limiter")` and is queried before routing a new
 * connection to its subject shard.
 *
 * Why a dedicated DO? Once `WebSocketDO` is sharded by subject, no individual
 * shard sees all of a single IP's connections, so per-IP limits can no longer
 * be enforced locally. This DO is the canonical authority for that counter.
 *
 * Invariants:
 * - `acquire(ip)` is the only path that grows a slot list. It prunes
 *   expired slots first, then rejects if the (still) live list is at the
 *   limit.
 * - `release(ip)` is fire-and-forget from the connection's `webSocketClose`
 *   handler. It shifts the oldest entry off the list (FIFO) and is a no-op
 *   when the list is empty — so a missed release (DO eviction, isolated
 *   crash) just leaves a slot in place and the periodic sweep reclaims it
 *   after `SLOT_TTL_MS`.
 * - The DO is cheap: `Map<ip, IpEntry>` with a periodic sweep. RAM ceiling
 *   is `O(unique active IPs)`, not `O(connections)`.
 *
 * Note: this DO is itself a single isolate, so under extreme connection-storm
 * pressure it can become a hot path. The acquire/release operations are
 * O(1) amortised (an O(slots) prune runs only on acquire, capped at
 * `MAX_CONNECTIONS_PER_IP`) and run for ~microseconds, so the throughput
 * ceiling is far above the subject-shard fan-out ceiling that the sharding
 * design fixes.
 */
export class WsIpLimiter extends DurableObject {
  private entries: Map<string, IpEntry> = new Map();
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  private ensureSweep() {
    if (this.sweepTimer) return;
    this.sweepTimer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
  }

  private stopSweep() {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  /**
   * Drop any slot timestamps older than `SLOT_TTL_MS`. Mutates `entry.slots`
   * in place. Returns whether the entry has any live slots left so callers
   * can short-circuit on empty.
   */
  private pruneExpiredSlots(entry: IpEntry, now: number): boolean {
    if (entry.slots.length === 0) return false;
    // Slots are inserted in chronological order, so the first non-expired
    // one terminates the scan — no full pass required even on a packed list.
    let firstLive = 0;
    while (
      firstLive < entry.slots.length &&
      now - entry.slots[firstLive] > SLOT_TTL_MS
    ) {
      firstLive++;
    }
    if (firstLive > 0) entry.slots.splice(0, firstLive);
    return entry.slots.length > 0;
  }

  private sweep() {
    const now = Date.now();
    for (const [ip, entry] of this.entries) {
      this.pruneExpiredSlots(entry, now);
      if (entry.slots.length === 0 && now - entry.lastSeen > STALE_ENTRY_TTL_MS) {
        this.entries.delete(ip);
      }
    }
    if (this.entries.size === 0) this.stopSweep();
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const now = Date.now();

    if (url.pathname === "/acquire" && request.method === "POST") {
      const { ip } = (await request.json()) as { ip: string };
      const entry = this.entries.get(ip) ?? { slots: [], lastSeen: now };
      this.pruneExpiredSlots(entry, now);
      if (entry.slots.length >= MAX_CONNECTIONS_PER_IP) {
        // Persist the lastSeen bump even on a reject so the sweep doesn't
        // immediately evict an entry that's actively being attempted.
        entry.lastSeen = now;
        this.entries.set(ip, entry);
        return Response.json({
          ok: false,
          count: entry.slots.length,
          limit: MAX_CONNECTIONS_PER_IP,
        });
      }
      entry.slots.push(now);
      entry.lastSeen = now;
      this.entries.set(ip, entry);
      this.ensureSweep();
      return Response.json({ ok: true, count: entry.slots.length });
    }

    if (url.pathname === "/release" && request.method === "POST") {
      const { ip } = (await request.json()) as { ip: string };
      const entry = this.entries.get(ip);
      if (entry) {
        // FIFO drop — we can't attribute a release to a specific acquired
        // slot (the wire protocol doesn't carry IDs), so dropping the
        // oldest is the closest stand-in. Leaked slots are also "old"
        // by definition, so this happens to favour evicting them first
        // under contention.
        if (entry.slots.length > 0) entry.slots.shift();
        entry.lastSeen = now;
        // Empty entries stay in the map for the STALE_ENTRY_TTL_MS window
        // so rapid reconnect-after-close doesn't pay a fresh allocation;
        // the sweep removes them after the window expires.
      }
      return Response.json({ ok: true });
    }

    if (url.pathname === "/debug") {
      const snapshot: Record<string, number> = {};
      for (const [ip, entry] of this.entries) {
        // Report the *live* count after pruning so an operator probing
        // this endpoint never sees stale leaked counts.
        this.pruneExpiredSlots(entry, now);
        snapshot[ip] = entry.slots.length;
      }
      return Response.json({
        size: this.entries.size,
        limit: MAX_CONNECTIONS_PER_IP,
        slotTtlMs: SLOT_TTL_MS,
        counts: snapshot,
      });
    }

    return new Response("Not found", { status: 404 });
  }
}

/**
 * Helper used by callers (the `/ws` route) to acquire a slot. Returns `true`
 * if the connection is permitted, `false` if the IP is already at the limit.
 */
export async function tryAcquireIpSlot(
  namespace: DurableObjectNamespace,
  ip: string,
): Promise<{ ok: boolean; count: number }> {
  const id = namespace.idFromName("ws-ip-limiter");
  const stub = namespace.get(id);
  const res = await stub.fetch("https://internal/acquire", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ip }),
  });
  return (await res.json()) as { ok: boolean; count: number };
}

/**
 * Fire-and-forget release. Callers should attach this to
 * `executionCtx.waitUntil` or call inside `webSocketClose` — never block on it.
 *
 * Errors are swallowed here so the function lives up to its "fire-and-forget"
 * docstring: a transient limiter-DO failure must not bubble into a caller
 * who is just trying to clean up a closed connection. A dropped release is
 * recovered by the sweep's per-slot TTL.
 */
export async function releaseIpSlot(
  namespace: DurableObjectNamespace,
  ip: string,
): Promise<void> {
  try {
    const id = namespace.idFromName("ws-ip-limiter");
    const stub = namespace.get(id);
    await stub.fetch("https://internal/release", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ip }),
    });
  } catch {
    // Intentional: see docstring. Dropped slot reclaimed by sweep TTL.
  }
}
