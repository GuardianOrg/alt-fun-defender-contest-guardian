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
  const trades = await queryAll<PonderRouterTrade>(
    `query ($limit: Int!, $offset: Int!) {
      routerTrades(limit: $limit, offset: $offset, orderBy: "timestamp", orderDirection: "desc") {
        items { trader timestamp }
      }
    }`,
    "routerTrades",
  );

  const dayWallets = new Map<string, Set<string>>();
  for (const t of trades) {
    const ts = Number(t.timestamp);
    if (ts < cutoff) continue;
    const day = toDayKey(ts);
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

  return c.json(formatSuccess(buildDaySeries(dayMap, days)));
});

admin.get("/analytics/volume", async (c) => {
  const days = parseDays(c.req.query("days"), 30);
  const cutoff = Math.floor(Date.now() / 1000) - days * 86400;

  const queryAll = createPonderPaginatedQuery(c.env.PONDER_URL);
  const trades = await queryAll<PonderRouterTrade>(
    `query ($limit: Int!, $offset: Int!) {
      routerTrades(limit: $limit, offset: $offset, orderBy: "timestamp", orderDirection: "desc") {
        items { usdcAmount timestamp }
      }
    }`,
    "routerTrades",
  );

  const dayMap = new Map<string, number>();
  for (const t of trades) {
    const ts = Number(t.timestamp);
    if (ts < cutoff) continue;
    const day = toDayKey(ts);
    const vol = Number(t.usdcAmount) / 1e6;
    dayMap.set(day, (dayMap.get(day) ?? 0) + vol);
  }

  return c.json(formatSuccess(buildDaySeries(dayMap, days)));
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

  const [graduations, allTokens] = await Promise.all([
    queryAll<PonderGraduation>(
      `query ($limit: Int!, $offset: Int!) {
        graduations(limit: $limit, offset: $offset, orderBy: "timestamp", orderDirection: "desc") {
          items { tokenAddress timestamp }
        }
      }`,
      "graduations",
    ),
    queryAll<PonderToken>(
      `query ($limit: Int!, $offset: Int!) {
        tokens(limit: $limit, offset: $offset, orderBy: "timestamp", orderDirection: "desc") {
          items { address timestamp }
        }
      }`,
      "tokens",
    ),
  ]);

  const gradDayMap = new Map<string, number>();
  const launchDayMap = new Map<string, number>();
  let totalGradTime = 0;
  let gradCount = 0;

  const tokenLaunchMap = new Map<string, number>();
  for (const t of allTokens) {
    const ts = Number(t.timestamp);
    tokenLaunchMap.set(t.address.toLowerCase(), ts);
    if (ts >= cutoff) {
      const day = toDayKey(ts);
      launchDayMap.set(day, (launchDayMap.get(day) ?? 0) + 1);
    }
  }

  for (const g of graduations) {
    const ts = Number(g.timestamp);
    if (ts >= cutoff) {
      const day = toDayKey(ts);
      gradDayMap.set(day, (gradDayMap.get(day) ?? 0) + 1);
    }
    const launchTs = tokenLaunchMap.get(g.tokenAddress.toLowerCase());
    if (launchTs) {
      totalGradTime += ts - launchTs;
      gradCount++;
    }
  }

  const totalLaunches = allTokens.filter((t) => Number(t.timestamp) >= cutoff).length;
  const totalGrads = graduations.filter((g) => Number(g.timestamp) >= cutoff).length;

  return c.json(
    formatSuccess({
      daily: buildDaySeries(gradDayMap, days),
      launches: buildDaySeries(launchDayMap, days),
      totalLaunches,
      totalGraduations: totalGrads,
      graduationRate: totalLaunches > 0 ? totalGrads / totalLaunches : 0,
      avgTimeToGraduationSeconds: gradCount > 0 ? Math.round(totalGradTime / gradCount) : null,
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
  const claims = await queryAll<PonderFeeClaim>(
    `query ($limit: Int!, $offset: Int!) {
      feeClaims(limit: $limit, offset: $offset, orderBy: "timestamp", orderDirection: "desc") {
        items { amount isCreator timestamp }
      }
    }`,
    "feeClaims",
  );

  const protocolDayMap = new Map<string, number>();
  const creatorDayMap = new Map<string, number>();

  for (const claim of claims) {
    const ts = Number(claim.timestamp);
    if (ts < cutoff) continue;
    const day = toDayKey(ts);
    const amount = Number(claim.amount) / 1e18;

    if (claim.isCreator) {
      creatorDayMap.set(day, (creatorDayMap.get(day) ?? 0) + amount);
    } else {
      protocolDayMap.set(day, (protocolDayMap.get(day) ?? 0) + amount);
    }
  }

  return c.json(
    formatSuccess({
      protocol: buildDaySeries(protocolDayMap, days),
      creator: buildDaySeries(creatorDayMap, days),
    }),
  );
});

export default admin;
