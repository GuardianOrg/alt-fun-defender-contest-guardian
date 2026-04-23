import { Hono } from "hono";

import { createPonderPaginatedQuery } from "../../lib/ponder-client.js";
import { usdcRawToUsd } from "../../lib/token-enrich.js";
import formatSuccess from "../../utils/format-success.js";

import type { AppBindings } from "../../lib/types.js";
import type {
  PonderRouterTrade,
  PonderGraduation,
  PonderToken,
  PonderFeeAccrual,
} from "../../lib/ponder-types.js";

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

analytics.get("/dau", async (c) => {
  const days = parseDays(c.req.query("days"), 30);
  const cutoff = Math.floor(Date.now() / 1000) - days * 86400;

  const queryAll = createPonderPaginatedQuery(c.env.PONDER_URL);
  const { items: trades, truncated } = await queryAll<Pick<PonderRouterTrade, "trader" | "timestamp">>(
    `query ($limit: Int!, $offset: Int!, $cutoff: BigInt!) {
      routerTrades(
        where: { timestamp_gte: $cutoff }
        limit: $limit, offset: $offset,
        orderBy: "timestamp", orderDirection: "desc"
      ) {
        items { trader timestamp }
      }
    }`,
    "routerTrades",
    { cutoff: String(cutoff) },
  );

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

  return c.json(formatSuccess({ series: buildDaySeries(dayMap, days), truncated }));
});

analytics.get("/volume", async (c) => {
  const days = parseDays(c.req.query("days"), 30);
  const cutoff = Math.floor(Date.now() / 1000) - days * 86400;

  const queryAll = createPonderPaginatedQuery(c.env.PONDER_URL);
  const { items: trades, truncated } = await queryAll<Pick<PonderRouterTrade, "usdcAmount" | "timestamp">>(
    `query ($limit: Int!, $offset: Int!, $cutoff: BigInt!) {
      routerTrades(
        where: { timestamp_gte: $cutoff }
        limit: $limit, offset: $offset,
        orderBy: "timestamp", orderDirection: "desc"
      ) {
        items { usdcAmount timestamp }
      }
    }`,
    "routerTrades",
    { cutoff: String(cutoff) },
  );

  const dayMicroMap = new Map<string, bigint>();
  for (const t of trades) {
    const day = toDayKey(Number(t.timestamp));
    dayMicroMap.set(day, (dayMicroMap.get(day) ?? 0n) + BigInt(t.usdcAmount));
  }

  // `usdcRawToUsd` splits the bigint into whole-dollar + sub-dollar halves
  // before casting to Number, pushing the precision ceiling well past
  // anything we'd see in a single day's USDC volume.
  const dayMap = new Map<string, number>();
  for (const [day, microUsdc] of dayMicroMap) {
    dayMap.set(day, usdcRawToUsd(microUsdc.toString()) ?? 0);
  }

  return c.json(formatSuccess({ series: buildDaySeries(dayMap, days), truncated }));
});

analytics.get("/graduations", async (c) => {
  const days = parseDays(c.req.query("days"), 30);
  const cutoff = Math.floor(Date.now() / 1000) - days * 86400;

  const queryAll = createPonderPaginatedQuery(c.env.PONDER_URL);

  const [gradResult, tokenResult] = await Promise.all([
    queryAll<PonderGraduation>(
      `query ($limit: Int!, $offset: Int!, $cutoff: BigInt!) {
        graduations(
          where: { timestamp_gte: $cutoff }
          limit: $limit, offset: $offset,
          orderBy: "timestamp", orderDirection: "desc"
        ) {
          items { tokenAddress timestamp }
        }
      }`,
      "graduations",
      { cutoff: String(cutoff) },
    ),
    queryAll<PonderToken>(
      `query ($limit: Int!, $offset: Int!, $cutoff: BigInt!) {
        tokens(
          where: { timestamp_gte: $cutoff }
          limit: $limit, offset: $offset,
          orderBy: "timestamp", orderDirection: "desc"
        ) {
          items { address timestamp }
        }
      }`,
      "tokens",
      { cutoff: String(cutoff) },
    ),
  ]);

  const graduations = gradResult.items;
  const windowTokens = tokenResult.items;
  const truncated = gradResult.truncated || tokenResult.truncated;

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
      avgTimeToGraduationSeconds: gradCount > 0 ? Math.round(totalGradTime / gradCount) : null,
      truncated,
    }),
  );
});

analytics.get("/revenue", async (c) => {
  const days = parseDays(c.req.query("days"), 30);
  const cutoff = Math.floor(Date.now() / 1000) - days * 86400;

  const queryAll = createPonderPaginatedQuery(c.env.PONDER_URL);
  // Accrual-based (earned, not paid-out). Fees are charged by `LaunchpadRouter`
  // and recorded in `FeeVault` regardless of claim timing, so revenue tracking
  // reads accruals directly — this decouples the dashboard from creators
  // forgetting to claim.
  const { items: accruals, truncated } = await queryAll<PonderFeeAccrual>(
    `query ($limit: Int!, $offset: Int!, $cutoff: BigInt!) {
      feeAccruals(
        where: { timestamp_gte: $cutoff }
        limit: $limit, offset: $offset,
        orderBy: "timestamp", orderDirection: "desc"
      ) {
        items { creatorAmount protocolAmount timestamp }
      }
    }`,
    "feeAccruals",
    { cutoff: String(cutoff) },
  );

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

  // `usdcRawToUsd` splits the bigint into whole-dollar + sub-dollar halves
  // before casting to Number, pushing the precision ceiling well past
  // anything we'd see in a single day's fee revenue.
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
      truncated,
    }),
  );
});

export default analytics;
