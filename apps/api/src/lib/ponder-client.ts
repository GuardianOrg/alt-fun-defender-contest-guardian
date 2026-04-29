const FALLBACK_URL = "http://localhost:42069";
const PAGE_SIZE = 1000;
const MAX_PAGES = 20;
const HEALTH_CHECK_TIMEOUT = 3000;

export function createPonderQuery(ponderUrl?: string) {
  const url = ponderUrl || FALLBACK_URL;

  return async function queryPonder<T>(
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<T | null> {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables }),
      });

      if (!res.ok) return null;

      const json = (await res.json()) as { data?: T; errors?: unknown[] };
      if (json.errors) return null;

      return json.data ?? null;
    } catch {
      return null;
    }
  };
}

/**
 * Check if the Ponder GraphQL API is reachable and actually able to serve
 * queries from its database.
 *
 * We deliberately do **not** probe with `{ __typename }` — that's resolved
 * from the schema in-process and a Ponder whose PGlite has crashed (e.g. a
 * stale `ponder dev` left over from a previous session) will still answer
 * it "successfully", masking the real outage. Instead we touch the `tokens`
 * collection with `limit: 1`, which forces a DB round-trip but stays
 * cheap. An empty list is fine — a healthy indexer pointed at a
 * freshly-deployed contract still answers, just with no rows.
 */
export async function checkPonderHealth(ponderUrl?: string): Promise<boolean> {
  const url = ponderUrl || FALLBACK_URL;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT);

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `query { tokens(limit: 1) { items { address } } }`,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) return false;

    const json = (await res.json()) as {
      data?: { tokens: { items: unknown[] } | null } | null;
      errors?: unknown[];
    };
    if (json.errors) return false;
    // `data` must be present (well-formed GraphQL response) and the
    // `tokens` field must have actually resolved. A response missing the
    // key entirely indicates a schema mismatch or a Ponder serving an
    // unrelated GraphQL endpoint.
    return !!json.data && "tokens" in json.data;
  } catch {
    return false;
  }
}

export interface PaginatedResult<T> {
  items: T[];
  truncated: boolean;
}

/**
 * Paginate through all results for a Ponder collection query.
 * `collectionKey` is the top-level field name in the GraphQL response (e.g. "routerTrades").
 * The query MUST use `$limit: Int!` and `$offset: Int!` variables.
 * Returns `{ items, truncated }` — `truncated` is true when MAX_PAGES was reached
 * and more data may exist.
 */
export function createPonderPaginatedQuery(ponderUrl?: string) {
  const queryPonder = createPonderQuery(ponderUrl);

  return async function queryPonderAll<TItem>(
    query: string,
    collectionKey: string,
    variables?: Record<string, unknown>,
  ): Promise<PaginatedResult<TItem>> {
    const all: TItem[] = [];
    let truncated = false;

    for (let page = 0; page < MAX_PAGES; page++) {
      const offset = page * PAGE_SIZE;
      const data = await queryPonder<Record<string, { items: TItem[] }>>(
        query,
        { ...variables, limit: PAGE_SIZE, offset },
      );

      const items = data?.[collectionKey]?.items ?? [];
      all.push(...items);

      if (items.length < PAGE_SIZE) break;

      if (page === MAX_PAGES - 1) {
        truncated = true;
      }
    }

    return { items: all, truncated };
  };
}
