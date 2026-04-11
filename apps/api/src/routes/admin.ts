import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { getAddress, isAddress } from "viem";

import { createDb } from "../db/client.js";
import { tokens } from "../db/schema.js";
import formatError from "../utils/format-error.js";
import formatSuccess from "../utils/format-success.js";
import { adminAuth } from "../middleware/admin-auth.js";
import { createPonderPaginatedQuery } from "../lib/ponder-client.js";

import type { AppBindings } from "../lib/types.js";

const admin = new Hono<{ Bindings: AppBindings }>();

admin.use("*", adminAuth);

admin.post("/tokens/:address/hide", async (c) => {
  const rawAddress = c.req.param("address");
  if (!isAddress(rawAddress)) {
    return c.json(formatError("Invalid address"), 400);
  }
  const address = getAddress(rawAddress);
  const db = createDb(c.env.DATABASE_URL);
  await db.update(tokens).set({ isHidden: true }).where(eq(tokens.address, address));
  return c.json(formatSuccess({ hidden: true }));
});

admin.post("/tokens/:address/unhide", async (c) => {
  const rawAddress = c.req.param("address");
  if (!isAddress(rawAddress)) {
    return c.json(formatError("Invalid address"), 400);
  }
  const address = getAddress(rawAddress);
  const db = createDb(c.env.DATABASE_URL);
  await db.update(tokens).set({ isHidden: false }).where(eq(tokens.address, address));
  return c.json(formatSuccess({ hidden: false }));
});

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

interface PonderRouterTrade {
  trader: string;
  usdcAmount: string;
  timestamp: string;
}

admin.get("/analytics/dau", async (c) => {
  const days = parseDays(c.req.query("days"), 30);
  const cutoff = Math.floor(Date.now() / 1000) - days * 86400;

  const queryAll = createPonderPaginatedQuery(c.env.PONDER_URL);
  const { items: trades, truncated } = await queryAll<PonderRouterTrade>(
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

admin.get("/analytics/volume", async (c) => {
  const days = parseDays(c.req.query("days"), 30);
  const cutoff = Math.floor(Date.now() / 1000) - days * 86400;

  const queryAll = createPonderPaginatedQuery(c.env.PONDER_URL);
  const { items: trades, truncated } = await queryAll<PonderRouterTrade>(
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

  const dayMap = new Map<string, number>();
  for (const [day, microUsdc] of dayMicroMap) {
    dayMap.set(day, Number(microUsdc) / 1e6);
  }

  return c.json(formatSuccess({ series: buildDaySeries(dayMap, days), truncated }));
});

interface PonderGraduation {
  tokenAddress: string;
  timestamp: string;
}

interface PonderToken {
  address: string;
  timestamp: string;
}

admin.get("/analytics/graduations", async (c) => {
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

interface PonderFeeClaim {
  amount: string;
  isCreator: boolean;
  timestamp: string;
}

admin.get("/analytics/revenue", async (c) => {
  const days = parseDays(c.req.query("days"), 30);
  const cutoff = Math.floor(Date.now() / 1000) - days * 86400;

  const queryAll = createPonderPaginatedQuery(c.env.PONDER_URL);
  const { items: claims, truncated } = await queryAll<PonderFeeClaim>(
    `query ($limit: Int!, $offset: Int!, $cutoff: BigInt!) {
      feeClaims(
        where: { timestamp_gte: $cutoff }
        limit: $limit, offset: $offset,
        orderBy: "timestamp", orderDirection: "desc"
      ) {
        items { amount isCreator timestamp }
      }
    }`,
    "feeClaims",
    { cutoff: String(cutoff) },
  );

  const protocolDayRaw = new Map<string, bigint>();
  const creatorDayRaw = new Map<string, bigint>();

  for (const claim of claims) {
    const day = toDayKey(Number(claim.timestamp));
    const raw = BigInt(claim.amount);

    if (claim.isCreator) {
      creatorDayRaw.set(day, (creatorDayRaw.get(day) ?? 0n) + raw);
    } else {
      protocolDayRaw.set(day, (protocolDayRaw.get(day) ?? 0n) + raw);
    }
  }

  const protocolDayMap = new Map<string, number>();
  for (const [day, raw] of protocolDayRaw) {
    protocolDayMap.set(day, Number(raw) / 1e18);
  }
  const creatorDayMap = new Map<string, number>();
  for (const [day, raw] of creatorDayRaw) {
    creatorDayMap.set(day, Number(raw) / 1e18);
  }

  return c.json(
    formatSuccess({
      protocol: buildDaySeries(protocolDayMap, days),
      creator: buildDaySeries(creatorDayMap, days),
      truncated,
    }),
  );
});

export default admin;
