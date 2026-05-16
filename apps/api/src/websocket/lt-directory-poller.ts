/**
 * LtDirectoryPoller — periodic mirror of the BounceTech LT directory
 * (`LeveragedTokenHelper.getLeveragedTokens()`) into our Neon
 * `lt_directory` table.
 *
 * A single global instance (`idFromName("lt-directory-poller-v2")`) wakes
 * itself every {@link POLL_INTERVAL_MS} via Durable Object alarms. Each
 * tick:
 *   1. Sets the next alarm FIRST so a thrown handler can never halt the
 *      cycle. Mirrors the same pattern as `LtTicker`.
 *   2. Calls `LeveragedTokenHelper.getLeveragedTokens()` over RPC using
 *      `HYPEREVM_RPC_URL` (falls back to the public HyperEVM RPC).
 *   3. For any LT address it hasn't seen yet, batched-reads `name`,
 *      `symbol`, `decimals` via the standard ERC-20 metadata calls.
 *      Those three fields are immutable for the life of an LT, so we
 *      cache them on the row and never re-read.
 *   4. Upserts each LT into `public.lt_directory`. Existing rows whose
 *      static fields changed (extremely unlikely — only really happens
 *      if BounceTech redeploys an LT under the same address, which they
 *      don't) are refreshed on the next miss; dynamic fields
 *      (`exchangeRate`, `mintPaused`, `baseAssetBalance`, `totalAssets`)
 *      always update.
 *   5. Bumps `pollSequence` and `lastSeenAt` for every row covered by
 *      the poll.
 *
 * Failure policy: the entire body is wrapped in a try/catch.
 * Any RPC / multicall / DB failure is logged and the alarm is
 * rescheduled — readers keep the previous snapshot. This matches the
 * fail-open posture of every other BounceTech-adjacent surface in the
 * API (`lt-availability`, `assets`, …) and is appropriate because the
 * directory changes slowly enough that even a multi-hour stale read
 * still serves the right data to the user-facing surface.
 *
 * Why a Durable Object (and not a Cron Worker or Ponder block handler):
 *   - We need sub-minute granularity for fast notification of
 *     `mintPaused` flips. Cloudflare cron triggers have a 1-minute
 *     floor; DO alarms go down to 1s.
 *   - We don't want this work serialised behind block processing in
 *     Ponder — a slow RPC call here must not stall trade / Sync
 *     handlers, and a fresh Ponder reindex must not burn RPC on
 *     `(currentBlock - startBlock) / 60` historical interval handlers
 *     for state that's only useful "right now".
 *   - We already have the DO-with-alarm pattern deployed via
 *     `LtTicker` — a second DO with a different cadence and a
 *     different responsibility is a small copy of a working pattern,
 *     not a new architectural piece.
 */
import { DurableObject } from "cloudflare:workers";
import { createPublicClient, getAddress, http, type Abi } from "viem";

import {
  HYPER_EVM,
  LEVERAGED_TOKEN_HELPER_ADDRESS,
  LeveragedTokenHelperAbi,
} from "@launchpad/shared";

import { createDb } from "../db/client.js";
import { ltDirectory } from "../db/schema.js";
import { sql } from "drizzle-orm";

import type { AppBindings } from "../lib/types.js";

const POLL_INTERVAL_MS = 30_000;
// 60 ticks × 30s = 30min heartbeat log cadence. The directory rarely
// changes so we log sparingly — the structured per-failure log line
// surfaces any actual problem.
const HEARTBEAT_LOG_EVERY_N_TICKS = 60;

/**
 * Minimal ERC-20 metadata ABI for the one-shot `name`/`symbol`/
 * `decimals` multicall on newly-discovered LT addresses. Kept inline
 * rather than imported from `LeveragedToken` because that ABI
 * deliberately omits these fields (it's the BounceTech-protocol-
 * specific surface) — using a separate fragment also makes the call
 * sites easier to grep.
 */
const erc20MetadataAbi = [
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
] as const satisfies Abi;

const chain = {
  id: HYPER_EVM.id,
  name: HYPER_EVM.name,
  nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
  rpcUrls: { default: { http: [HYPER_EVM.rpcUrl] } },
} as const;

interface HelperLtRow {
  leveragedToken: `0x${string}`;
  targetAsset: string;
  targetLeverage: bigint;
  isLong: boolean;
  exchangeRate: bigint;
  baseAssetBalance: bigint;
  totalAssets: bigint;
  mintPaused: boolean;
}

interface HelperReturn extends HelperLtRow {
  marketId: number;
  hyperliquidNotional: bigint;
  userCredit: bigint;
  credit: bigint;
  agentData: readonly { slot: number; agent: `0x${string}`; createdAt: bigint }[];
  balanceOf: bigint;
  isStandbyMode: boolean;
}

interface HeartbeatState {
  lastTickAt: number | null;
  lastSuccessAt: number | null;
  lastError: string | null;
  tickCount: number;
  successCount: number;
  lastDirectorySize: number;
  lastPollSequence: number;
}

export class LtDirectoryPoller extends DurableObject<AppBindings> {
  private staticMetaCache: Map<
    string,
    { name: string; symbol: string; decimals: number }
  > = new Map();
  private pollSequence = 0;
  private heartbeat: HeartbeatState = {
    lastTickAt: null,
    lastSuccessAt: null,
    lastError: null,
    tickCount: 0,
    successCount: 0,
    lastDirectorySize: 0,
    lastPollSequence: 0,
  };

  constructor(ctx: DurableObjectState, env: AppBindings) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const stored = (await ctx.storage.get<number>("pollSequence")) ?? 0;
      this.pollSequence = stored;
      const existing = await ctx.storage.getAlarm();
      if (existing === null) {
        await ctx.storage.setAlarm(Date.now() + POLL_INTERVAL_MS);
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/ensure") {
      const existing = await this.ctx.storage.getAlarm();
      const scheduledFor = existing ?? Date.now() + POLL_INTERVAL_MS;
      if (existing === null) {
        await this.ctx.storage.setAlarm(scheduledFor);
        this.log("info", "lt_directory_poller_kickstart", {});
      }
      return Response.json({
        ...this.heartbeat,
        alarmScheduledFor: scheduledFor,
      });
    }
    return new Response("Not found", { status: 404 });
  }

  async alarm(): Promise<void> {
    // Reschedule FIRST. A throw inside the body must never break the
    // cycle — every other periodic DO in this codebase follows the
    // same convention (`lt-ticker.ts`).
    await this.ctx.storage.setAlarm(Date.now() + POLL_INTERVAL_MS);

    this.heartbeat.tickCount++;
    this.heartbeat.lastTickAt = Date.now();

    try {
      const directory = await this.fetchDirectoryFromHelper();
      if (directory.length === 0) {
        // Empty response is either an upstream regression or a fresh
        // helper deployment with no LTs registered yet. Don't clobber
        // the existing rows — leave readers on the last good snapshot.
        // Emit a structured warn alongside the heartbeat-state update so
        // an empty payload surfaces in real-time logs instead of only
        // through the 30-minute heartbeat tick. CodeRabbit feedback on
        // PR #947.
        this.heartbeat.lastError = "empty_directory_response";
        this.log("warn", "lt_directory_poller_empty_response", {
          tickCount: this.heartbeat.tickCount,
        });
        return;
      }

      const meta = await this.resolveStaticMeta(
        directory.map((d) => getAddress(d.leveragedToken)),
      );

      this.pollSequence += 1;
      await this.ctx.storage.put("pollSequence", this.pollSequence);
      await this.upsertRows(directory, meta, this.pollSequence);

      this.heartbeat.lastSuccessAt = Date.now();
      this.heartbeat.lastError = null;
      this.heartbeat.successCount++;
      this.heartbeat.lastDirectorySize = directory.length;
      this.heartbeat.lastPollSequence = this.pollSequence;

      if (this.heartbeat.tickCount % HEARTBEAT_LOG_EVERY_N_TICKS === 0) {
        this.log("info", "lt_directory_poller_heartbeat", {
          tickCount: this.heartbeat.tickCount,
          successCount: this.heartbeat.successCount,
          lastDirectorySize: this.heartbeat.lastDirectorySize,
          lastPollSequence: this.heartbeat.lastPollSequence,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.heartbeat.lastError = message;
      this.log("error", "lt_directory_poller_failure", { error: message });
    }
  }

  private async fetchDirectoryFromHelper(): Promise<HelperLtRow[]> {
    const transport = http(this.env.HYPEREVM_RPC_URL || HYPER_EVM.rpcUrl);
    const client = createPublicClient({ chain, transport });
    const result = (await client.readContract({
      address: LEVERAGED_TOKEN_HELPER_ADDRESS as `0x${string}`,
      abi: LeveragedTokenHelperAbi,
      functionName: "getLeveragedTokens",
    })) as readonly HelperReturn[];
    return result.map((r) => ({
      leveragedToken: r.leveragedToken,
      targetAsset: r.targetAsset,
      targetLeverage: r.targetLeverage,
      isLong: r.isLong,
      exchangeRate: r.exchangeRate,
      baseAssetBalance: r.baseAssetBalance,
      totalAssets: r.totalAssets,
      mintPaused: r.mintPaused,
    }));
  }

  /**
   * Resolve `name` / `symbol` / `decimals` for every address in the
   * provided set, hitting the in-isolate cache first and only doing
   * RPC reads for previously-unseen LTs. Each unseen LT triggers three
   * sequential single-call reads — we deliberately don't use a viem
   * `multicall` here because:
   *
   *   - On the alarm path, an "unseen LT" is a rare event (only fires
   *     when BounceTech adds a new LT — typically a few times per
   *     quarter).
   *   - HyperEVM doesn't ship the canonical Multicall3 deploy and
   *     plumbing a custom multicall address is more code than the
   *     savings warrant for a path that does ~3 calls per quarter.
   *
   * On any individual read failure the LT is skipped from the upsert
   * batch — the row will be re-attempted on the next poll.
   */
  private async resolveStaticMeta(
    addresses: readonly `0x${string}`[],
  ): Promise<Map<string, { name: string; symbol: string; decimals: number }>> {
    const out = new Map<string, { name: string; symbol: string; decimals: number }>();
    const transport = http(this.env.HYPEREVM_RPC_URL || HYPER_EVM.rpcUrl);
    const client = createPublicClient({ chain, transport });

    for (const address of addresses) {
      const key = address.toLowerCase();
      const cached = this.staticMetaCache.get(key);
      if (cached) {
        out.set(key, cached);
        continue;
      }
      try {
        const [name, symbol, decimals] = await Promise.all([
          client.readContract({
            address,
            abi: erc20MetadataAbi,
            functionName: "name",
          }) as Promise<string>,
          client.readContract({
            address,
            abi: erc20MetadataAbi,
            functionName: "symbol",
          }) as Promise<string>,
          client.readContract({
            address,
            abi: erc20MetadataAbi,
            functionName: "decimals",
          }) as Promise<number>,
        ]);
        const entry = { name, symbol, decimals };
        this.staticMetaCache.set(key, entry);
        out.set(key, entry);
      } catch (err) {
        this.log("warn", "lt_directory_static_meta_resolve_failed", {
          address,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return out;
  }

  private async upsertRows(
    directory: HelperLtRow[],
    meta: Map<string, { name: string; symbol: string; decimals: number }>,
    pollSequence: number,
  ): Promise<void> {
    const db = createDb(this.env.DATABASE_URL);
    const now = new Date();
    const rows = directory
      .map((d) => {
        const key = d.leveragedToken.toLowerCase();
        const m = meta.get(key);
        // Skip LTs whose static metadata we couldn't resolve. Next
        // poll will retry — we'd rather omit the row than insert a
        // half-populated one that downstream consumers have to
        // defensively guard against.
        if (!m) return null;
        return {
          address: getAddress(d.leveragedToken),
          symbol: m.symbol,
          name: m.name,
          targetAsset: d.targetAsset,
          // BounceTech encodes targetLeverage as multiplier × 1e18 on-chain.
          // Unscale to match the human-readable 2/3/5 the schema column and
          // every other consumer (`LiveLeveragedToken.targetLeverage: number`)
          // expects. Divide as BigInt first — `Number(3e18n)` would silently
          // lose precision past Number.MAX_SAFE_INTEGER (~9e15).
          targetLeverage: Number(d.targetLeverage / 10n ** 18n),
          isLong: d.isLong,
          decimals: m.decimals,
          exchangeRate: d.exchangeRate.toString(),
          mintPaused: d.mintPaused,
          baseAssetBalance: d.baseAssetBalance.toString(),
          totalAssets: d.totalAssets.toString(),
          pollSequence,
          lastSeenAt: now,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    if (rows.length === 0) return;

    // Drizzle's `onConflictDoUpdate` runs a single round-trip `INSERT
    // ... ON CONFLICT DO UPDATE` for the whole batch. We update every
    // dynamic field plus `pollSequence` / `lastSeenAt` so a row that's
    // been in the directory for a while still has its timestamp
    // bumped. `createdAt` is left alone via `DEFAULT NOW()` semantics.
    await db
      .insert(ltDirectory)
      .values(rows)
      .onConflictDoUpdate({
        target: ltDirectory.address,
        set: {
          symbol: sql`excluded.symbol`,
          name: sql`excluded.name`,
          targetAsset: sql`excluded.target_asset`,
          targetLeverage: sql`excluded.target_leverage`,
          isLong: sql`excluded.is_long`,
          decimals: sql`excluded.decimals`,
          exchangeRate: sql`excluded.exchange_rate`,
          mintPaused: sql`excluded.mint_paused`,
          baseAssetBalance: sql`excluded.base_asset_balance`,
          totalAssets: sql`excluded.total_assets`,
          pollSequence: sql`excluded.poll_sequence`,
          lastSeenAt: sql`excluded.last_seen_at`,
        },
      });
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
