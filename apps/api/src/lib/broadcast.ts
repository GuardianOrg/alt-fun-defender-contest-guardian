import { broadcastShardsFor } from "../websocket/durable-object.js";

import type { AppBindings } from "./types.js";

/**
 * Fan out an event to the relevant `WebSocketDO` shards.
 *
 * For per-token channels (`trade`, `price`, `graduation`) with a
 * `tokenAddress`, this targets two shards:
 *   - `${channel}:${tokenAddress}` for clients scoped to that token.
 *   - `${channel}:__all__` for global / wildcard subscribers.
 *
 * Both fetches run in parallel; failures on one don't block the other.
 *
 * For global channels (`newToken`, `stats`) or events with no token, only
 * the wildcard shard is targeted (single fetch).
 */
export async function broadcastToChannel(
  env: AppBindings,
  channel: string,
  data: unknown,
  tokenAddress?: string,
): Promise<void> {
  const shards = broadcastShardsFor(channel, tokenAddress);
  const body = JSON.stringify({ channel, data });

  await Promise.all(
    shards.map(async (shardKey) => {
      const id = env.WEBSOCKET_DO.idFromName(shardKey);
      const stub = env.WEBSOCKET_DO.get(id);
      // Stamp the shard key on the URL so the DO can log it; the
      // `idFromName` mapping is one-way so it's the only way the DO
      // discovers its own subject. Build a fresh URL each iteration so
      // concurrent fetches can't observe each other's mutations.
      const url = new URL("https://internal/broadcast");
      url.searchParams.set("shard", shardKey);
      try {
        const res = await stub.fetch(url.toString(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        });
        // `stub.fetch` only rejects on transport / runtime failures —
        // a 5xx / 4xx from the DO comes back as a resolved Response.
        // Treat any non-OK status as a fan-out failure so a sick shard
        // doesn't silently swallow events.
        if (!res.ok) {
          throw new Error(
            `shard ${shardKey} responded ${res.status} ${res.statusText}`,
          );
        }
      } catch (err: unknown) {
        // Swallow per-shard failures — a stuck shard must not stall
        // the rest of the fan-out. Log structured so they surface in
        // workers observability without crashing the broadcaster.
        console.log(
          JSON.stringify({
            level: "warn",
            event: "broadcast_shard_failed",
            shard: shardKey,
            channel,
            error: err instanceof Error ? err.message : String(err),
            timestamp: new Date().toISOString(),
          }),
        );
      }
    }),
  );
}
