import { Hono } from "hono";
import { neon } from "@neondatabase/serverless";
import { getAddress } from "viem";

import formatSuccess from "../utils/format-success.js";
import formatError from "../utils/format-error.js";
import {
  createPonderQuery,
  createPonderPaginatedQuery,
} from "../lib/ponder-client.js";

import type { AppBindings } from "../lib/types.js";

const TOKEN_SUPPLY = 1_000_000_000;
const RATIO_PRECISION = 10n ** 18n;

interface PonderTokenInfo {
  address: string;
  ltToken: string;
  k: string;
  curveSupply: string;
  ltReserve: string;
  graduated: boolean;
  timestamp: string;
}

interface PonderTrade {
  tokenAddress: string;
  curveSupply: string;
  ltReserve: string;
  timestamp: string;
}

interface BounceLt {
  address: string;
  exchangeRate: string;
}

interface MarketDataItem {
  mcapUsd: number;
  change24h: number;
}

function bigintRatio(numerator: bigint, denominator: bigint): number {
  if (denominator === 0n) return 0;
  return Number((numerator * RATIO_PRECISION) / denominator) / 1e18;
}

const marketData = new Hono<{ Bindings: AppBindings }>();

marketData.get("/", async (c) => {
  const queryPonder = createPonderQuery(c.env.PONDER_URL);

  const healthCheck = await queryPonder<{ __typename: string }>(
    "{ __typename }",
  );
  if (healthCheck === null) {
    return c.json(formatError("Indexer unavailable"), 503);
  }

  // 1. Fetch all tokens from Ponder (current on-chain state)
  const queryPonderAll = createPonderPaginatedQuery(c.env.PONDER_URL);
  const ponderResult = await queryPonderAll<PonderTokenInfo>(
    `query ($limit: Int!, $offset: Int!) {
      tokens(limit: $limit, offset: $offset, orderBy: "timestamp", orderDirection: "desc") {
        items {
          address
          ltToken
          k
          curveSupply
          ltReserve
          graduated
          timestamp
        }
      }
    }`,
    "tokens",
  );

  const ponderTokens = ponderResult.items;
  if (ponderTokens.length === 0) {
    return c.json(formatSuccess({}));
  }

  // 2. Fetch current LT exchange rates from BounceTech indexing API
  const currentRatesMap = new Map<string, number>();
  try {
    const res = await fetch("https://indexing.bounce.tech/leveraged-tokens");
    const json = (await res.json()) as { data: BounceLt[] };
    for (const lt of json.data) {
      const rate = Number(BigInt(lt.exchangeRate)) / 1e18;
      currentRatesMap.set(lt.address.toLowerCase(), rate);
    }
  } catch {
    return c.json(formatSuccess({}));
  }

  // 3. Collect unique LT addresses and fetch 24h-ago exchange rates from BounceTech DB
  const uniqueLtAddresses = [
    ...new Set(ponderTokens.map((t) => t.ltToken.toLowerCase())),
  ];
  const nowSec = Math.floor(Date.now() / 1000);
  const cutoffSec = nowSec - 86_400;

  const pastRatesMap = new Map<string, number>();

  if (c.env.BOUNCETECH_DATABASE_URL) {
    try {
      const btSql = neon(c.env.BOUNCETECH_DATABASE_URL);
      const checksummedLts = uniqueLtAddresses.map((a) => getAddress(a));

      const rows = (await btSql`
        SELECT DISTINCT ON (token_address)
          token_address,
          exchange_rate::text AS exchange_rate
        FROM token_snapshots_v1
        WHERE token_address = ANY(${checksummedLts})
          AND tick_timestamp <= to_timestamp(${cutoffSec})
        ORDER BY token_address, tick_timestamp DESC
      `) as unknown as { token_address: string; exchange_rate: string }[];

      for (const row of rows) {
        pastRatesMap.set(
          row.token_address.toLowerCase(),
          Number(row.exchange_rate) / 1e18,
        );
      }
    } catch {
      // If DB query fails, 24h change will be 0
    }
  }

  // 4. Query recent trades to determine 24h-ago ratios
  // Fetch the most recent trades before the cutoff (one per token)
  const pastRatioMap = new Map<string, number>();

  try {
    const tradesResult = await queryPonderAll<PonderTrade>(
      `query ($cutoff: BigInt!, $limit: Int!, $offset: Int!) {
        trades(
          where: { timestamp_lte: $cutoff }
          limit: $limit
          offset: $offset
          orderBy: "timestamp"
          orderDirection: "desc"
        ) {
          items {
            tokenAddress
            curveSupply
            ltReserve
            timestamp
          }
        }
      }`,
      "trades",
      { cutoff: String(cutoffSec) },
    );

    // For each unique token, take the first (most recent before cutoff)
    for (const trade of tradesResult.items) {
      const addr = trade.tokenAddress.toLowerCase();
      if (!pastRatioMap.has(addr)) {
        const curveSupply = BigInt(trade.curveSupply);
        const ltReserve = BigInt(trade.ltReserve);
        if (curveSupply > 0n) {
          pastRatioMap.set(addr, bigintRatio(ltReserve, curveSupply));
        }
      }
    }
  } catch {
    // If trade query fails, 24h change will use current ratio as fallback
  }

  // 5. Compute market data for each token
  const result: Record<string, MarketDataItem> = {};

  for (const token of ponderTokens) {
    const addr = token.address.toLowerCase();
    const ltAddr = token.ltToken.toLowerCase();
    const curveSupply = BigInt(token.curveSupply);
    const ltReserve = BigInt(token.ltReserve);

    const currentExRate = currentRatesMap.get(ltAddr) ?? 0;
    const currentRatio =
      curveSupply > 0n ? bigintRatio(ltReserve, curveSupply) : 0;
    const currentPrice = currentRatio * currentExRate;
    const mcapUsd = currentPrice * TOKEN_SUPPLY;

    // Compute 24h change
    let change24h = 0;
    const pastExRate = pastRatesMap.get(ltAddr);

    if (pastExRate && pastExRate > 0) {
      // Past ratio: from trades before cutoff, or current ratio if no trades found
      const pastRatio = pastRatioMap.get(addr) ?? currentRatio;
      const pastPrice = pastRatio * pastExRate;

      if (pastPrice > 0) {
        change24h = ((currentPrice - pastPrice) / pastPrice) * 100;
      }
    }

    result[addr] = { mcapUsd, change24h };
  }

  return c.json(formatSuccess(result));
});

export default marketData;
