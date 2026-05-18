import { Hono } from "hono";
import type { Context } from "hono";

import { createDb } from "../../db/client.js";
import {
  fetchFeeAccrualsSince,
  fetchGraduationsSince,
  fetchRouterTradesForAnalytics,
  fetchTokensLaunchedSince,
} from "../../lib/indexer-reads.js";
import { usdcRawToUsd } from "../../lib/token-enrich.js";
import formatError from "../../utils/format-error.js";
import formatSuccess from "../../utils/format-success.js";

import type { AppBindings } from "../../lib/types.js";

function parseDays(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 && n <= 365 ? n : fallback;
}

function toDayKey(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString().slice(0, 10);
}

function buildDaySeries(
  dayMap: Map<string, number>,
  days: number,
): { date: string; value: number }[] {
  const result: { date: string; value: number }[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    result.push({ date: key, value: dayMap.get(key) ?? 0 });
  }
  return result;
}

const analytics = new Hono<{ Bindings: AppBindings }>();

// Issue #942: the v1 GraphQL-backed handlers were retired. The DB-backed
// handlers below now serve both the canonical paths and their additive
// `-v2` siblings (kept as aliases so any consumer already on `-v2` keeps
// working). `truncated` is always `false` — a single Postgres query
// returns every row in the window with no paginator cap.

async function dauHandler(c: Context<{ Bindings: AppBindings }>) {
  const days = parseDays(c.req.query("days"), 30);
  const cutoff = Math.floor(Date.now() / 1000) - days * 86400;

  const db = createDb(c.env.DATABASE_URL);
  const trades = await fetchRouterTradesForAnalytics(db, cutoff);
  if (trades === null) return c.json(formatError("Indexer unavailable"), 503);

  const dayWallets = new Map<string, Set<string>>();
  for (const t of trades) {
    const day = toDayKey(Number(t.timestamp));
    let wallets = dayWallets.get(day);
    if (!wallets) {
      wallets = new Set();
      dayWallets.set(day, wallets);
    }
    wallets.add(t.trader.toLowerCase());
  }

  const dayMap = new Map<string, number>();
  for (const [day, wallets] of dayWallets) {
    dayMap.set(day, wallets.size);
  }

  return c.json(
    formatSuccess({ series: buildDaySeries(dayMap, days), truncated: false }),
  );
}

async function volumeHandler(c: Context<{ Bindings: AppBindings }>) {
  const days = parseDays(c.req.query("days"), 30);
  const cutoff = Math.floor(Date.now() / 1000) - days * 86400;

  const db = createDb(c.env.DATABASE_URL);
  const trades = await fetchRouterTradesForAnalytics(db, cutoff);
  if (trades === null) return c.json(formatError("Indexer unavailable"), 503);

  const dayMicroMap = new Map<string, bigint>();
  for (const t of trades) {
    const day = toDayKey(Number(t.timestamp));
    dayMicroMap.set(day, (dayMicroMap.get(day) ?? 0n) + BigInt(t.usdcAmount));
  }

  const dayMap = new Map<string, number>();
  for (const [day, microUsdc] of dayMicroMap) {
    dayMap.set(day, usdcRawToUsd(microUsdc.toString()) ?? 0);
  }

  return c.json(
    formatSuccess({ series: buildDaySeries(dayMap, days), truncated: false }),
  );
}

async function graduationsHandler(
  c: Context<{ Bindings: AppBindings }>,
) {
  const days = parseDays(c.req.query("days"), 30);
  const cutoff = Math.floor(Date.now() / 1000) - days * 86400;

  const db = createDb(c.env.DATABASE_URL);
  const [graduations, windowTokens] = await Promise.all([
    fetchGraduationsSince(db, cutoff),
    fetchTokensLaunchedSince(db, cutoff),
  ]);
  if (graduations === null || windowTokens === null) {
    return c.json(formatError("Indexer unavailable"), 503);
  }

  const gradDayMap = new Map<string, number>();
  const launchDayMap = new Map<string, number>();
  let totalGradTime = 0;
  let gradCount = 0;

  const tokenLaunchMap = new Map<string, number>();
  for (const t of windowTokens) {
    const ts = Number(t.timestamp);
    tokenLaunchMap.set(t.address.toLowerCase(), ts);
    const day = toDayKey(ts);
    launchDayMap.set(day, (launchDayMap.get(day) ?? 0) + 1);
  }
  const totalLaunches = windowTokens.length;

  for (const g of graduations) {
    const ts = Number(g.timestamp);
    const day = toDayKey(ts);
    gradDayMap.set(day, (gradDayMap.get(day) ?? 0) + 1);
    const launchTs = tokenLaunchMap.get(g.tokenAddress.toLowerCase());
    if (launchTs) {
      totalGradTime += ts - launchTs;
      gradCount++;
    }
  }
  const totalGrads = graduations.length;

  return c.json(
    formatSuccess({
      daily: buildDaySeries(gradDayMap, days),
      launches: buildDaySeries(launchDayMap, days),
      totalLaunches,
      totalGraduations: totalGrads,
      graduationRate: totalLaunches > 0 ? gradCount / totalLaunches : 0,
      avgTimeToGraduationSeconds:
        gradCount > 0 ? Math.round(totalGradTime / gradCount) : null,
      truncated: false,
    }),
  );
}

async function revenueHandler(c: Context<{ Bindings: AppBindings }>) {
  const days = parseDays(c.req.query("days"), 30);
  const cutoff = Math.floor(Date.now() / 1000) - days * 86400;

  const db = createDb(c.env.DATABASE_URL);
  // Accrual-based (earned, not paid-out). Fees are charged by `Zap`
  // and recorded in `FeeVault` regardless of claim timing, so revenue
  // tracking reads accruals directly — this decouples the dashboard from
  // creators forgetting to claim.
  const accruals = await fetchFeeAccrualsSince(db, cutoff);
  if (accruals === null) return c.json(formatError("Indexer unavailable"), 503);

  const protocolDayRaw = new Map<string, bigint>();
  const creatorDayRaw = new Map<string, bigint>();

  for (const accrual of accruals) {
    const day = toDayKey(Number(accrual.timestamp));
    const creatorRaw = BigInt(accrual.creatorAmount);
    const protocolRaw = BigInt(accrual.protocolAmount);

    if (creatorRaw > 0n) {
      creatorDayRaw.set(day, (creatorDayRaw.get(day) ?? 0n) + creatorRaw);
    }
    if (protocolRaw > 0n) {
      protocolDayRaw.set(day, (protocolDayRaw.get(day) ?? 0n) + protocolRaw);
    }
  }

  const protocolDayMap = new Map<string, number>();
  for (const [day, raw] of protocolDayRaw) {
    protocolDayMap.set(day, usdcRawToUsd(raw.toString()) ?? 0);
  }
  const creatorDayMap = new Map<string, number>();
  for (const [day, raw] of creatorDayRaw) {
    creatorDayMap.set(day, usdcRawToUsd(raw.toString()) ?? 0);
  }

  return c.json(
    formatSuccess({
      protocol: buildDaySeries(protocolDayMap, days),
      creator: buildDaySeries(creatorDayMap, days),
      truncated: false,
    }),
  );
}

analytics.get("/dau", dauHandler);
analytics.get("/dau-v2", dauHandler);
analytics.get("/volume", volumeHandler);
analytics.get("/volume-v2", volumeHandler);
analytics.get("/graduations", graduationsHandler);
analytics.get("/graduations-v2", graduationsHandler);
analytics.get("/revenue", revenueHandler);
analytics.get("/revenue-v2", revenueHandler);

export default analytics;
