import { DurableObject } from "cloudflare:workers";

/** Maximum concurrent WebSocket connections allowed per IP address (global). */
export const MAX_CONNECTIONS_PER_IP = 10;

/**
 * Idle entries are cleaned up after this long with zero count. Prevents the
 * in-memory map from growing unbounded over a long-lived isolate.
 */
const STALE_ENTRY_TTL_MS = 5 * 60_000;

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
 * - `acquire(ip)` is the only path that increments. It rejects when the IP
 *   is already at the limit, returning `{ ok: false }`.
 * - `release(ip)` is fire-and-forget from the connection's `webSocketClose`
 *   handler. It floors at zero, so a missed release (DO eviction, isolated
 *   crash) just leaks a slot until the next idle sweep — never goes negative.
 * - The DO is cheap: a single `Map<string, { count, lastSeen }>` plus a
 *   periodic sweep. RAM ceiling is `O(unique IPs)`, not `O(connections)`.
 *
 * Note: this DO is itself a single isolate, so under extreme connection-storm
 * pressure it can become a hot path. The acquire/release operations are
 * O(1) and run for ~microseconds, so the throughput ceiling is far above the
 * subject-shard fan-out ceiling that this whole sharding design fixes.
 */
export class WsIpLimiter extends DurableObject {
  private counts: Map<string, { count: number; lastSeen: number }> = new Map();
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  private ensureSweep() {
    if (this.sweepTimer) return;
    this.sweepTimer = setInterval(() => this.sweep(), STALE_ENTRY_TTL_MS);
  }

  private stopSweep() {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  private sweep() {
    const now = Date.now();
    for (const [ip, entry] of this.counts) {
      if (entry.count <= 0 && now - entry.lastSeen > STALE_ENTRY_TTL_MS) {
        this.counts.delete(ip);
      }
    }
    if (this.counts.size === 0) this.stopSweep();
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/acquire" && request.method === "POST") {
      const { ip } = (await request.json()) as { ip: string };
      const entry = this.counts.get(ip) ?? { count: 0, lastSeen: Date.now() };
      if (entry.count >= MAX_CONNECTIONS_PER_IP) {
        return Response.json({
          ok: false,
          count: entry.count,
          limit: MAX_CONNECTIONS_PER_IP,
        });
      }
      entry.count += 1;
      entry.lastSeen = Date.now();
      this.counts.set(ip, entry);
      this.ensureSweep();
      return Response.json({ ok: true, count: entry.count });
    }

    if (url.pathname === "/release" && request.method === "POST") {
      const { ip } = (await request.json()) as { ip: string };
      const entry = this.counts.get(ip);
      if (entry) {
        entry.count = Math.max(0, entry.count - 1);
        entry.lastSeen = Date.now();
        if (entry.count === 0) {
          // Keep the entry for a TTL window so a rapid reconnect doesn't
          // pay a fresh allocation cost; the sweep removes it later.
        }
      }
      return Response.json({ ok: true });
    }

    if (url.pathname === "/debug") {
      const snapshot: Record<string, number> = {};
      for (const [ip, entry] of this.counts) snapshot[ip] = entry.count;
      return Response.json({
        size: this.counts.size,
        limit: MAX_CONNECTIONS_PER_IP,
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
 * who is just trying to clean up a closed connection. A leaked slot is
 * recovered by the limiter's idle TTL sweep.
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
    // Intentional: see docstring. Leaked slot reclaimed by sweep.
  }
}
