import { describeError } from "./log-error.js";

const FALLBACK_URL = "http://localhost:42069";
const PAGE_SIZE = 1000;
/**
 * Maximum pages the paginator will fetch before giving up and returning
 * `truncated: true`. Defensive cap against an unbounded GraphQL query
 * sweeping the entire indexer table — every remaining caller of the
 * paginator (`chart`, `holders`, `referrals`, `admin/analytics`,
 * `balances`, `trades`, `fetchRouterTradeActivity`,
 * `fetchTokensOnchainByAddresses`) bounds its own input (per-token,
 * per-wallet, per-time-window), so 20 pages × 1,000 rows = 20K is two
 * orders of magnitude above any realistic per-request need today.
 *
 * The previously-problematic full-catalogue caller (`fetchAllTokensOnchain`,
 * silent truncation at 20K tokens) has been retired in favour of the
 * per-page `POST /market-data { addresses }` endpoint, so this cap no
 * longer silently truncates any read path.
 */
const MAX_PAGES = 20;
const HEALTH_CHECK_TIMEOUT = 3000;
/**
 * Truncation guard so a sprawling aliased query (e.g. the 50-token batch
 * `fetchHistoricalCurveSnapshots` builds) doesn't fill the log line. We
 * only need enough to identify the query and grep for it in the source.
 */
const LOG_QUERY_SNIPPET_LEN = 200;

/**
 * Compact failure logger for `queryPonder`. The three swallow paths
 * (non-200 HTTP, GraphQL `errors[]`, fetch exception) are all visually
 * identical from the caller — a `null` return — so without logging there's
 * no way to tell from prod tails which one fired. Structured fields so
 * the Cloudflare log search filters by `event:"ponder_query_failed"` and
 * by `mode` to triage.
 *
 * The `error` payload mirrors `logIndexerReadFailure` (issue #974) — pulls
 * `cause` / `code` / `sourceError` to the top level so transport-layer
 * failures (network timeout, AbortSignal, IPv6 fallback) are diagnosable
 * from one log line.
 */
function logPonderFailure(args: {
  url: string;
  query: string;
  variables: Record<string, unknown> | undefined;
  mode: "http_error" | "graphql_errors" | "network_error";
  status?: number;
  body?: string;
  graphqlErrors?: unknown[];
  error?: unknown;
}) {
  const { url, query, variables, mode, status, body, graphqlErrors, error } =
    args;
  const aliasCount = (query.match(/^\s*t\d+:/gm) ?? []).length;
  console.log(
    JSON.stringify({
      level: "error",
      event: "ponder_query_failed",
      mode,
      url,
      status,
      // Aliased queries (`fetchHistoricalCurveSnapshots`) are the highest-
      // risk failure surface; surfacing the alias count separately makes
      // it easy to filter Cloudflare logs by "heavy aliased query failed"
      // without grepping the snippet.
      aliasCount,
      querySnippet: query.slice(0, LOG_QUERY_SNIPPET_LEN),
      variables,
      graphqlErrors,
      // Truncate body — Ponder's error responses can be verbose (full
      // schema dump on validation failure). 1KB is enough to identify
      // the failure class.
      body: body?.slice(0, 1024),
      error: describeError(error),
      timestamp: new Date().toISOString(),
    }),
  );
}

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

      if (!res.ok) {
        // Read the body for log context — Ponder returns
        // `{ errors: [...] }` on GraphQL-level rejections with a 4xx (e.g.
        // query validation failures), and a stack trace as text on 5xx.
        // Either is gold for narrowing down why a previously-fine query
        // started failing in prod.
        const body = await res.text().catch(() => "<unreadable>");
        logPonderFailure({
          url,
          query,
          variables,
          mode: "http_error",
          status: res.status,
          body,
        });
        return null;
      }

      const json = (await res.json()) as { data?: T; errors?: unknown[] };
      if (json.errors) {
        logPonderFailure({
          url,
          query,
          variables,
          mode: "graphql_errors",
          status: res.status,
          graphqlErrors: json.errors,
        });
        return null;
      }

      return json.data ?? null;
    } catch (error) {
      logPonderFailure({
        url,
        query,
        variables,
        mode: "network_error",
        error,
      });
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
