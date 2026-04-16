import { Hono } from "hono";
import { getAddress, isAddress } from "viem";
import { neon } from "@neondatabase/serverless";

import formatSuccess from "../utils/format-success.js";
import formatError from "../utils/format-error.js";
import {
  createPonderQuery,
  createPonderPaginatedQuery,
} from "../lib/ponder-client.js";

import type { AppBindings } from "../lib/types.js";

const TOKEN_SUPPLY = 1_000_000_000;
const RATIO_PRECISION = 10n ** 18n;
const CACHE_TTL_SECONDS = 30;
const BATCH_SIZE = 50;

interface PonderTokenInfo {
  address: string;
  ltToken: string;
  curveSupply: string;
  ltReserve: string;
  timestamp: string;
}

interface PonderTokenSnapshot {
  curveSupply: string;
  ltReserve: string;
  timestamp: string;
}

interface PonderSnapshotPage {
  items: PonderTokenSnapshot[];
}

interface BounceLt {
  address: string;
  exchangeRate: string;
}

interface BounceHistoricalRow {
  token_address: string;
  exchange_rate: string;
}

export interface MarketDataItem {
  mcapUsd: number | null;
  change24h: number | null;
  past24hPriceUsd: number | null;
}

function bigintRatio(numerator: bigint, denominator: bigint): number {
  if (denominator === 0n) return 0;
  return Number((numerator * RATIO_PRECISION) / denominator) / 1e18;
}

function computePrice(
  curveSupply: bigint,
  ltReserve: bigint,
  ltExchangeRate: number,
): number {
  if (curveSupply === 0n || ltExchangeRate <= 0) return 0;
  const ratio = bigintRatio(ltReserve, curveSupply);
  return ratio * ltExchangeRate;
}

async function fetchLiveLtRates(): Promise<Map<string, number> | null> {
  try {
    const res = await fetch("https://indexing.bounce.tech/leveraged-tokens");
    if (!res.ok) return null;
    const json = (await res.json()) as { data: BounceLt[] };
    const map = new Map<string, number>();
    for (const lt of json.data) {
      map.set(lt.address.toLowerCase(), Number(BigInt(lt.exchangeRate)) / 1e18);
    }
    return map;
  } catch {
    return null;
  }
}

async function fetchCurrentTokens(
  ponderUrl: string | undefined,
): Promise<PonderTokenInfo[] | null> {
  const queryPonderAll = createPonderPaginatedQuery(ponderUrl);
  try {
    const result = await queryPonderAll<PonderTokenInfo>(
      `query ($limit: Int!, $offset: Int!) {
        tokens(limit: $limit, offset: $offset, orderBy: "timestamp", orderDirection: "desc") {
          items {
            address
            ltToken
            curveSupply
            ltReserve
            timestamp
          }
        }
      }`,
      "tokens",
    );
    return result.items;
  } catch {
    return null;
  }
}

/**
 * Fetch the latest `tokenSnapshot` ≤ cutoff for each token address via aliased
 * sub-selections (one GraphQL round-trip per batch). Returns `null` if the
 * indexer is unreachable.
 */
async function fetchHistoricalCurveSnapshots(
  ponderUrl: string | undefined,
  tokenAddresses: string[],
  cutoffSec: number,
): Promise<Map<string, PonderTokenSnapshot | null> | null> {
  const queryPonder = createPonderQuery(ponderUrl);
  const snapshots = new Map<string, PonderTokenSnapshot | null>();
  for (const addr of tokenAddresses) snapshots.set(addr, null);

  for (let i = 0; i < tokenAddresses.length; i += BATCH_SIZE) {
    const batch = tokenAddresses.slice(i, i + BATCH_SIZE);
    const selections = batch
      .map(
        (addr, j) =>
          `t${j}: tokenSnapshots(
            where: { tokenAddress: "${addr}", timestamp_lte: "${cutoffSec}" }
            orderBy: "timestamp"
            orderDirection: "desc"
            limit: 1
          ) { items { curveSupply, ltReserve, timestamp } }`,
      )
      .join("\n");

    const query = `query {
      ${selections}
    }`;

    const data = await queryPonder<Record<string, PonderSnapshotPage>>(query);
    if (data === null) return null;

    for (let j = 0; j < batch.length; j++) {
      const page = data[`t${j}`];
      snapshots.set(batch[j], page?.items?.[0] ?? null);
    }
  }

  return snapshots;
}

/**
 * Fetch the latest BounceTech LT exchange rate ≤ cutoff for each LT address
 * from the `token_snapshots_v1` table that BounceTech has been populating
 * since inception.
 *
 * Implementation note: we run this as a `LATERAL` join over `unnest(addresses)`
 * rather than `WHERE token_address = ANY(...) ... DISTINCT ON (token_address)`.
 * The LATERAL form is a per-address index seek on `(token_address, tick_timestamp DESC)`
 * which is sub-second on the multi-million-row snapshot table; the DISTINCT ON
 * form times out because the planner doesn't push the sort into the index for
 * `ANY()`. The chart endpoint uses the same LATERAL pattern.
 *
 * Returns a map keyed by lowercased LT address → exchange rate as a `number`
 * (18-decimal value already divided). Missing entries indicate no rate was
 * recorded before the cutoff for that LT.
 */
async function fetchHistoricalLtRates(
  databaseUrl: string | undefined,
  ltAddresses: string[],
  cutoffSec: number,
): Promise<Map<string, number> | null> {
  if (!databaseUrl) return null;
  if (ltAddresses.length === 0) return new Map();

  const checksummed = ltAddresses.map((addr) => getAddress(addr));
  const sql = neon(databaseUrl);

  try {
    const rows = (await sql`
      SELECT a.address AS token_address, t.exchange_rate::text AS exchange_rate
      FROM unnest(${checksummed}::text[]) AS a(address)
      CROSS JOIN LATERAL (
        SELECT exchange_rate
        FROM token_snapshots_v1
        WHERE token_address = a.address
          AND tick_timestamp <= to_timestamp(${cutoffSec})
        ORDER BY tick_timestamp DESC
        LIMIT 1
      ) t
    `) as unknown as BounceHistoricalRow[];

    const map = new Map<string, number>();
    for (const row of rows) {
      map.set(
        row.token_address.toLowerCase(),
        Number(BigInt(row.exchange_rate)) / 1e18,
      );
    }
    return map;
  } catch {
    return null;
  }
}

function buildMarketDataItem(
  token: PonderTokenInfo,
  liveLtRates: Map<string, number>,
  historicalCurve: Map<string, PonderTokenSnapshot | null>,
  historicalLtRates: Map<string, number>,
  cutoffSec: number,
): MarketDataItem {
  const ltAddr = token.ltToken.toLowerCase();
  const tokenAddr = token.address.toLowerCase();

  const currentExRate = liveLtRates.get(ltAddr) ?? 0;
  const currentCurveSupply = BigInt(token.curveSupply);
  const currentLtReserve = BigInt(token.ltReserve);

  const currentPrice = computePrice(
    currentCurveSupply,
    currentLtReserve,
    currentExRate,
  );
  const mcapUsd = currentPrice > 0 ? currentPrice * TOKEN_SUPPLY : null;

  const launchTimestamp = Number(token.timestamp);
  const tokenIsTooNew = launchTimestamp > cutoffSec;

  let past24hPriceUsd: number | null = null;
  if (!tokenIsTooNew) {
    const pastRate = historicalLtRates.get(ltAddr);
    if (pastRate !== undefined && pastRate > 0) {
      // Use the curve state at cutoff if we have a snapshot for it; otherwise
      // the curve hasn't moved since (no trades in the last 24h) so the current
      // curve state equals the cutoff-time curve state.
      const snapshot = historicalCurve.get(tokenAddr);
      const supply = snapshot
        ? BigInt(snapshot.curveSupply)
        : currentCurveSupply;
      const reserve = snapshot
        ? BigInt(snapshot.ltReserve)
        : currentLtReserve;
      past24hPriceUsd = computePrice(supply, reserve, pastRate);
    }
  }

  let change24h: number | null = null;
  if (
    past24hPriceUsd !== null &&
    past24hPriceUsd > 0 &&
    currentPrice > 0
  ) {
    change24h = ((currentPrice - past24hPriceUsd) / past24hPriceUsd) * 100;
  }

  return {
    mcapUsd,
    change24h,
    past24hPriceUsd,
  };
}

type ComputeBatchResult =
  | { ok: true; data: Record<string, MarketDataItem> }
  | { ok: false; error: string; code: 503 };
type ComputeSingleResult =
  | { ok: true; data: MarketDataItem }
  | { ok: false; error: string; code: 404 | 503 };

async function computeBatch(
  ponderUrl: string | undefined,
  bouncetechDbUrl: string | undefined,
): Promise<ComputeBatchResult> {
  const tokens = await fetchCurrentTokens(ponderUrl);
  if (tokens === null) {
    return { ok: false, error: "Indexer unavailable", code: 503 };
  }
  if (tokens.length === 0) {
    return { ok: true, data: {} };
  }

  const liveLtRates = await fetchLiveLtRates();
  if (liveLtRates === null) {
    return { ok: false, error: "BounceTech API unavailable", code: 503 };
  }

  const cutoffSec = Math.floor(Date.now() / 1000) - 86_400;
  const tokenAddresses = tokens.map((t) => t.address.toLowerCase());
  const ltAddresses = Array.from(
    new Set(tokens.map((t) => t.ltToken.toLowerCase())),
  );

  const [historicalCurve, historicalLtRates] = await Promise.all([
    fetchHistoricalCurveSnapshots(ponderUrl, tokenAddresses, cutoffSec),
    fetchHistoricalLtRates(bouncetechDbUrl, ltAddresses, cutoffSec),
  ]);
  if (historicalCurve === null) {
    return { ok: false, error: "Indexer unavailable", code: 503 };
  }
  if (historicalLtRates === null) {
    return {
      ok: false,
      error: "BounceTech snapshot DB unavailable",
      code: 503,
    };
  }

  const result: Record<string, MarketDataItem> = {};
  for (const token of tokens) {
    const addr = token.address.toLowerCase();
    result[addr] = buildMarketDataItem(
      token,
      liveLtRates,
      historicalCurve,
      historicalLtRates,
      cutoffSec,
    );
  }
  return { ok: true, data: result };
}

async function computeSingle(
  ponderUrl: string | undefined,
  bouncetechDbUrl: string | undefined,
  tokenAddress: string,
): Promise<ComputeSingleResult> {
  const queryPonder = createPonderQuery(ponderUrl);
  const data = await queryPonder<{ token: PonderTokenInfo | null }>(
    `query ($address: String!) {
      token(address: $address) {
        address
        ltToken
        curveSupply
        ltReserve
        timestamp
      }
    }`,
    { address: tokenAddress.toLowerCase() },
  );
  if (data === null) {
    return { ok: false, error: "Indexer unavailable", code: 503 };
  }
  const token = data.token;
  if (!token) {
    return { ok: false, error: "Token not found", code: 404 };
  }

  const liveLtRates = await fetchLiveLtRates();
  if (liveLtRates === null) {
    return { ok: false, error: "BounceTech API unavailable", code: 503 };
  }

  const cutoffSec = Math.floor(Date.now() / 1000) - 86_400;
  const [historicalCurve, historicalLtRates] = await Promise.all([
    fetchHistoricalCurveSnapshots(
      ponderUrl,
      [token.address.toLowerCase()],
      cutoffSec,
    ),
    fetchHistoricalLtRates(
      bouncetechDbUrl,
      [token.ltToken.toLowerCase()],
      cutoffSec,
    ),
  ]);
  if (historicalCurve === null) {
    return { ok: false, error: "Indexer unavailable", code: 503 };
  }
  if (historicalLtRates === null) {
    return {
      ok: false,
      error: "BounceTech snapshot DB unavailable",
      code: 503,
    };
  }

  return {
    ok: true,
    data: buildMarketDataItem(
      token,
      liveLtRates,
      historicalCurve,
      historicalLtRates,
      cutoffSec,
    ),
  };
}

const marketData = new Hono<{ Bindings: AppBindings }>();

marketData.get("/", async (c) => {
  const cachesObj = (globalThis as { caches?: { default?: Cache } }).caches;
  const cache = cachesObj?.default;
  const cacheKey = new Request(new URL(c.req.url).toString(), { method: "GET" });

  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  }

  const result = await computeBatch(
    c.env.PONDER_URL,
    c.env.BOUNCETECH_DATABASE_URL,
  );
  if (!result.ok) {
    return c.json(formatError(result.error), result.code);
  }

  const response = c.json(formatSuccess(result.data));
  response.headers.set("Cache-Control", `s-maxage=${CACHE_TTL_SECONDS}`);

  if (cache) {
    await cache.put(cacheKey, response.clone());
  }

  return response;
});

marketData.get("/:address", async (c) => {
  const address = c.req.param("address");
  if (!address || !isAddress(address)) {
    return c.json(formatError("Invalid token address"), 400);
  }

  const result = await computeSingle(
    c.env.PONDER_URL,
    c.env.BOUNCETECH_DATABASE_URL,
    address,
  );
  if (!result.ok) {
    return c.json(formatError(result.error), result.code);
  }

  return c.json(formatSuccess(result.data));
});

export default marketData;
