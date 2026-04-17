import { DurableObject } from "cloudflare:workers";
import { getAddress } from "viem";
import { neon } from "@neondatabase/serverless";

import { broadcastToChannel } from "../lib/broadcast.js";
import { createDb } from "../db/client.js";
import { tokens } from "../db/schema.js";

import type { AppBindings } from "../lib/types.js";

const TICK_INTERVAL_MS = 2_000;
const LT_REFRESH_INTERVAL_MS = 60_000;
const HEARTBEAT_LOG_EVERY_N_TICKS = 30;

interface LtRateRow {
  token_address: string;
  exchange_rate: string;
}

interface HeartbeatState {
  lastTickAt: number | null;
  lastBroadcastAt: number | null;
  lastError: string | null;
  tickCount: number;
  trackedLtCount: number;
}

/**
 * LtTicker — scheduled publisher of BounceTech Leveraged Token exchange rate
 * ticks onto the `price` WS channel.
 *
 * A single global instance (`idFromName("lt-ticker")`) wakes itself every
 * TICK_INTERVAL_MS via Durable Object alarms. Each tick:
 *   1. Sets the next alarm FIRST so a thrown handler never halts the cycle.
 *   2. Refreshes the tracked LT address set from Postgres (cached ~60s).
 *   3. Queries the latest `exchange_rate` per LT from BounceTech's snapshot DB
 *      using the same LATERAL pattern as `fetchHistoricalLtRates`.
 *   4. Diffs against an in-memory `lastSeen` map and broadcasts only changed
 *      rates to the `price` channel, keyed by LT address for per-LT routing.
 *
 * Cadence is intentionally matched to BounceTech's ~2s write cadence on
 * `token_snapshots_v1` — polling faster just returns duplicate values.
 *
 * Kickstart comes from a 1-minute Cron Trigger that POSTs to `/ensure`; any
 * manual admin hit to that endpoint also suffices to start a dormant ticker.
 */
export class LtTicker extends DurableObject<AppBindings> {
  private lastSeen: Map<string, string> = new Map();
  private trackedLts: string[] = [];
  private trackedLtsRefreshedAt = 0;
  private heartbeat: HeartbeatState = {
    lastTickAt: null,
    lastBroadcastAt: null,
    lastError: null,
    tickCount: 0,
    trackedLtCount: 0,
  };

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/ensure") {
      const existing = await this.ctx.storage.getAlarm();
      if (existing === null) {
        await this.ctx.storage.setAlarm(Date.now() + TICK_INTERVAL_MS);
        this.log("info", "lt_ticker_kickstart", {});
      }
      return Response.json({
        ...this.heartbeat,
        alarmScheduledFor: existing ?? Date.now() + TICK_INTERVAL_MS,
      });
    }

    return new Response("Not found", { status: 404 });
  }

  async alarm(): Promise<void> {
    // Set the next alarm FIRST so any thrown error in the body doesn't kill
    // the schedule. We own the reschedule explicitly rather than relying on
    // CF's thrown-alarm retry backoff, which isn't the cadence we want.
    await this.ctx.storage.setAlarm(Date.now() + TICK_INTERVAL_MS);

    try {
      await this.refreshTrackedLtsIfStale();

      if (this.trackedLts.length === 0) {
        this.heartbeat.lastTickAt = Date.now();
        this.heartbeat.tickCount++;
        this.heartbeat.trackedLtCount = 0;
        return;
      }

      const rates = await this.fetchLatestRates(this.trackedLts);
      const changed = this.diffAndUpdateLastSeen(rates);

      if (changed.length > 0) {
        await Promise.all(
          changed.map((entry) =>
            broadcastToChannel(
              this.env,
              "price",
              {
                ltAddress: entry.ltAddress,
                exchangeRate: entry.exchangeRate,
                ts: Math.floor(Date.now() / 1000),
              },
              entry.ltAddress,
            ),
          ),
        );
        this.heartbeat.lastBroadcastAt = Date.now();
      }

      this.heartbeat.lastTickAt = Date.now();
      this.heartbeat.lastError = null;
      this.heartbeat.tickCount++;
      this.heartbeat.trackedLtCount = this.trackedLts.length;

      if (this.heartbeat.tickCount % HEARTBEAT_LOG_EVERY_N_TICKS === 0) {
        this.log("info", "lt_ticker_heartbeat", {
          tickCount: this.heartbeat.tickCount,
          trackedLtCount: this.trackedLts.length,
          lastBroadcastAt: this.heartbeat.lastBroadcastAt,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.heartbeat.lastError = message;
      this.heartbeat.lastTickAt = Date.now();
      this.heartbeat.tickCount++;
      this.log("error", "lt_ticker_failure", { error: message });
    }
  }

  private async refreshTrackedLtsIfStale(): Promise<void> {
    const now = Date.now();
    if (
      this.trackedLts.length > 0 &&
      now - this.trackedLtsRefreshedAt < LT_REFRESH_INTERVAL_MS
    ) {
      return;
    }

    const db = createDb(this.env.DATABASE_URL);
    const rows = await db
      .selectDistinct({ ltPair: tokens.ltPair })
      .from(tokens);

    const set = new Set<string>();
    for (const row of rows) {
      if (row.ltPair) set.add(getAddress(row.ltPair));
    }

    this.trackedLts = Array.from(set);
    this.trackedLtsRefreshedAt = now;
  }

  private async fetchLatestRates(
    ltAddresses: string[],
  ): Promise<Map<string, string>> {
    if (!this.env.BOUNCETECH_DATABASE_URL) {
      throw new Error("BOUNCETECH_DATABASE_URL is not configured");
    }
    const sql = neon(this.env.BOUNCETECH_DATABASE_URL);

    const rows = (await sql`
      SELECT a.address AS token_address, t.exchange_rate::text AS exchange_rate
      FROM unnest(${ltAddresses}::text[]) AS a(address)
      CROSS JOIN LATERAL (
        SELECT exchange_rate
        FROM token_snapshots_v1
        WHERE token_address = a.address
        ORDER BY tick_timestamp DESC
        LIMIT 1
      ) t
    `) as unknown as LtRateRow[];

    const map = new Map<string, string>();
    for (const row of rows) {
      map.set(row.token_address.toLowerCase(), row.exchange_rate);
    }
    return map;
  }

  private diffAndUpdateLastSeen(
    rates: Map<string, string>,
  ): { ltAddress: string; exchangeRate: string }[] {
    const changed: { ltAddress: string; exchangeRate: string }[] = [];
    for (const [ltAddress, exchangeRate] of rates) {
      const prev = this.lastSeen.get(ltAddress);
      if (prev !== exchangeRate) {
        this.lastSeen.set(ltAddress, exchangeRate);
        changed.push({ ltAddress, exchangeRate });
      }
    }
    return changed;
  }

  private log(level: string, event: string, data: Record<string, unknown>) {
    const entry = {
      level,
      event,
      timestamp: new Date().toISOString(),
      ...data,
    };
    console.log(JSON.stringify(entry));
  }
}
