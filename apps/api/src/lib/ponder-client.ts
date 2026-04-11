const FALLBACK_URL = "http://localhost:42069";
const PAGE_SIZE = 1000;
const MAX_PAGES = 20;

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
