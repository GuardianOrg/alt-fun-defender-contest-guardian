/**
 * Fire-and-forget broadcast helper. POSTs an event to the API Worker's
 * `/api/v1/webhook/indexer` endpoint, which rebroadcasts it across the
 * WebSocket Durable Object.
 *
 * Failures are logged but never thrown — Ponder event handlers must not block
 * on the API being reachable. If the POST fails, the event is still indexed
 * into Postgres and clients get it on their next REST refresh.
 *
 * Historical backfill is skipped via `isLiveEvent()` so restarting the
 * indexer doesn't replay thousands of stale broadcasts.
 */

import type { TradeBroadcast } from "@launchpad/shared";

const WEBHOOK_TIMEOUT_MS = 1_000;
/** Blocks older than this (seconds) are considered backfill, not live. */
const LIVE_WINDOW_SEC = 60;
/**
 * Absorb minor forward drift between block timestamps and the indexer's
 * wall-clock. Anything beyond this is treated as clock corruption / malformed
 * data and filtered out rather than broadcast.
 */
const CLOCK_SKEW_TOLERANCE_SEC = 30;

/**
 * Discriminated union for all outgoing webhook events. The `trade` variant
 * uses the shared `TradeBroadcast` shape so the web client and indexer can
 * never drift on the WS payload contract.
 */
export type WebhookEvent =
  | { event: "trade"; data: TradeBroadcast; tokenAddress?: string }
  | { event: "newToken" | "graduation" | "price" | "stats"; data: unknown; tokenAddress?: string };

export function isLiveEvent(blockTimestampSec: bigint | number): boolean {
  const ts = typeof blockTimestampSec === "bigint"
    ? Number(blockTimestampSec)
    : blockTimestampSec;
  const nowSec = Math.floor(Date.now() / 1000);
  const ageSec = nowSec - ts;
  return ageSec >= -CLOCK_SKEW_TOLERANCE_SEC && ageSec <= LIVE_WINDOW_SEC;
}

export function broadcastEvent(payload: WebhookEvent): void {
  const url = process.env.API_WEBHOOK_URL;
  const adminKey = process.env.ADMIN_API_KEY;

  if (!url || !adminKey) {
    // Silently skip when unconfigured (e.g. local dev without the API Worker
    // running). Don't spam logs on every event.
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

  fetch(`${url.replace(/\/$/, "")}/api/v1/webhook/indexer`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Key": adminKey,
    },
    body: JSON.stringify(payload),
    signal: controller.signal,
  })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.log(
        JSON.stringify({
          level: "warn",
          event: "webhook_broadcast_failed",
          broadcastEvent: payload.event,
          error: message,
          timestamp: new Date().toISOString(),
        }),
      );
    })
    .finally(() => clearTimeout(timer));
}
