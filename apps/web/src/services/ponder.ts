const ponderUrl = import.meta.env.VITE_PONDER_URL;
if (!ponderUrl) {
  throw new Error("VITE_PONDER_URL is not set");
}
const PONDER_URL = ponderUrl;

export interface PonderToken {
  address: string;
  name: string;
  symbol: string;
  creator: string;
  ltToken: string;
  k: string;
  curveSupply: string;
  ltReserve: string;
  graduated: boolean;
  graduatedAt: string | null;
  bondingPair: string | null;
  hyperswapPair: string | null;
  blockNumber: string;
  timestamp: string;
}

export interface PonderTrade {
  id: string;
  tokenAddress: string;
  trader: string;
  isBuy: boolean;
  ltAmount: string;
  tokenAmount: string;
  curveSupply: string;
  ltReserve: string;
  blockNumber: string;
  timestamp: string;
}

async function ponderQuery<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(PONDER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(`Ponder query failed: ${res.status}`);
  }

  const json = (await res.json()) as { data: T; errors?: { message: string }[] };
  if (json.errors?.length) {
    throw new Error(json.errors[0].message);
  }
  return json.data;
}

export async function fetchPonderTokens(limit = 50): Promise<PonderToken[]> {
  const data = await ponderQuery<{ tokens: { items: PonderToken[] } }>(
    `query($limit: Int!) {
      tokens(limit: $limit, orderBy: "timestamp", orderDirection: "desc") {
        items {
          address name symbol creator ltToken k
          curveSupply ltReserve graduated graduatedAt
          bondingPair hyperswapPair blockNumber timestamp
        }
      }
    }`,
    { limit },
  );
  return data.tokens.items;
}

export async function fetchPonderToken(address: string): Promise<PonderToken | null> {
  const data = await ponderQuery<{ token: PonderToken | null }>(
    `query($address: String!) {
      token(address: $address) {
        address name symbol creator ltToken k
        curveSupply ltReserve graduated graduatedAt
        bondingPair hyperswapPair blockNumber timestamp
      }
    }`,
    { address },
  );
  return data.token;
}

/**
 * Bonding-curve trades (`Bonding.Trade` events). NOT graduation-aware — the
 * `trade` table only covers curve-phase activity, post-graduation trades live
 * in `routerTrade` (Zap `Buy`/`Sell` events) and are exposed via
 * `fetchRouterTradesGlobal` / `fetchRouterTradesByToken` in `services/api.ts`.
 *
 * Currently unused by the trade feed (which switched to `routerTrade` for
 * graduation coverage). Kept as a thin wrapper for analytics/debugging that
 * specifically wants curve-only history; reach for the API helpers in
 * normal product code.
 */
export async function fetchPonderTrades(
  tokenAddress?: string,
  limit = 50,
): Promise<PonderTrade[]> {
  if (tokenAddress) {
    const data = await ponderQuery<{ trades: { items: PonderTrade[] } }>(
      `query($tokenAddress: String!, $limit: Int!) {
        trades(
          where: { tokenAddress: $tokenAddress }
          limit: $limit
          orderBy: "timestamp"
          orderDirection: "desc"
        ) {
          items {
            id tokenAddress trader isBuy ltAmount tokenAmount
            curveSupply ltReserve blockNumber timestamp
          }
        }
      }`,
      { tokenAddress, limit },
    );
    return data.trades.items;
  }

  const data = await ponderQuery<{ trades: { items: PonderTrade[] } }>(
    `query($limit: Int!) {
      trades(limit: $limit, orderBy: "timestamp", orderDirection: "desc") {
        items {
          id tokenAddress trader isBuy ltAmount tokenAmount
          curveSupply ltReserve blockNumber timestamp
        }
      }
    }`,
    { limit },
  );
  return data.trades.items;
}
