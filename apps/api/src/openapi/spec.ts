/**
 * OpenAPI 3.1 specification for the Alt Fun API.
 *
 * Covers all /api/v1/* endpoints with request/response schemas,
 * authentication details, WebSocket protocol docs, and error formats.
 */

import { SUPPORTED_UNDERLYING_ASSETS } from "@launchpad/shared";

/**
 * Single source of truth for the `underlying` enum exposed by the API. Mirrors
 * `SUPPORTED_UNDERLYING_ASSETS` so the OpenAPI schema can't drift from the
 * filter / DB column / web client when a new BounceTech LT asset is added.
 */
const UNDERLYING_ENUM = [...SUPPORTED_UNDERLYING_ASSETS];

const errorResponse = {
  type: "object" as const,
  properties: {
    status: { type: "string" as const, enum: ["error"], example: "error" },
    error: { type: "string" as const, example: "Error message" },
    data: { type: "null" as const },
  },
  required: ["status", "error", "data"],
};

function successResponse(dataSchema: Record<string, unknown>, dataSource = false) {
  const props: Record<string, unknown> = {
    status: { type: "string", enum: ["success"], example: "success" },
    data: dataSchema,
    error: { type: "null" },
  };
  const required = ["status", "data", "error"];

  if (dataSource) {
    props["dataSource"] = {
      type: "string",
      enum: ["live", "degraded"],
      description: "Indicates Ponder indexer availability. 'degraded' means on-chain data may be stale.",
    };
  }

  return { type: "object" as const, properties: props, required };
}

const addressParam = (name: string, description: string) => ({
  name,
  in: "path" as const,
  required: true,
  schema: { type: "string" as const, pattern: "^0x[a-fA-F0-9]{40}$" },
  description,
});

const paginationParams = [
  {
    name: "limit",
    in: "query" as const,
    schema: { type: "integer" as const, minimum: 0, maximum: 100, default: 50 },
    description: "Maximum number of items to return",
  },
  {
    name: "offset",
    in: "query" as const,
    schema: { type: "integer" as const, minimum: 0, default: 0 },
    description: "Number of items to skip",
  },
];

const tokenSchema = {
  type: "object" as const,
  properties: {
    address: { type: "string", example: "0x1234567890abcdef1234567890abcdef12345678" },
    name: { type: "string", example: "Moon Cat" },
    ticker: { type: "string", example: "MCAT" },
    description: { type: "string" },
    imageUrl: { type: "string" },
    ltPair: { type: "string", description: "Address of the BounceTech Leveraged Token used as reserve" },
    ltDirection: { type: "string", enum: ["long", "short"] },
    leverage: { type: "integer", enum: [2, 3, 5] },
    underlying: { type: "string", enum: UNDERLYING_ENUM },
    status: { type: "string", enum: ["curve", "graduating", "graduated"] },
    graduated: { type: "boolean", description: "Whether the token has graduated to HyperSwap. Derived from the on-chain curve state." },
    graduatedAt: { type: "string", format: "date-time", nullable: true },
    poolAddress: { type: "string", nullable: true, description: "HyperSwap V2 pair address after graduation" },
    bondingPair: { type: "string", nullable: true, description: "Bonding-curve pair contract address. `null` while Ponder is unavailable." },
    hyperswapPair: { type: "string", nullable: true, description: "HyperSwap V2 pair address after graduation (duplicate of `poolAddress`, kept for clients keyed on the on-chain field name)." },
    priceUsd: { type: "number", nullable: true, description: "Current token price in USD. `null` when Ponder or BounceTech is degraded — treat as unknown, never zero." },
    mcapUsd: { type: "number", nullable: true, description: "Current fully-diluted market cap in USD (`priceUsd × 1B`). `null` under the same degraded conditions as `priceUsd`." },
    change24h: { type: "number", nullable: true, description: "24h price change as a percentage. For tokens younger than 24h this is the since-launch delta. `null` when the reference price is unavailable." },
    ltChange24h: { type: "number", nullable: true, description: "24h percentage change of the backing LT's exchange rate (independent of any curve / router activity). `null` when BounceTech has no rate at either end of the window." },
    volume24hUsd: { type: "number", nullable: true, description: "Total USD routed through `Zap` for this token in the last 24h (buys + sells). `0` = no trades in the window (legitimately quiet); `null` = indexer aggregation unavailable (unknown). Sole signal behind `?sort=trending`." },
    totalVolumeUsd: { type: "number", nullable: true, description: "Lifetime gross USD routed through `Zap` for this token (buys + sells, never subtracts). Sourced from the indexer's running counter on the `token` row so it's not affected by pagination truncation. `null` only when the indexer is unreachable; `0` when the token has never traded." },
    lastTradeAt: { type: "string", format: "date-time", nullable: true, description: "Timestamp of the most recent `Zap` trade within the 24h window. `null` means either no trades in that window or indexer unavailable — disambiguate using `volume24hUsd`." },
    twitterUrl: { type: "string", description: "Twitter / X handle (no `@`, no URL prefix). Frontend builds the link as `https://x.com/<handle>`. Empty string when the creator did not set one or supplied a value that failed sanitisation. Pre-#400 rows may still hold legacy URLs; clients should pass the value through `buildTwitterUrl` before rendering." },
    telegramUrl: { type: "string", description: "Telegram path component (`<username>`, `+<invite>`, or `joinchat/<hash>`). Frontend builds the link as `https://t.me/<value>`. Empty string when unset or invalid. Pre-#400 rows may still hold legacy URLs; clients should pass the value through `buildTelegramUrl` before rendering." },
    websiteUrl: { type: "string", description: "Canonical http(s) URL with multi-label ASCII hostname (no userinfo). Empty string when unset or invalid. Pre-#400 rows may still hold legacy / unvalidated values; clients should pass the value through `buildWebsiteUrl` before rendering." },
    creator: { type: "string" },
    isHidden: { type: "boolean" },
    createdAt: { type: "string", format: "date-time" },
  },
};

const tokenDetailSchema = {
  type: "object" as const,
  allOf: [
    { $ref: "#/components/schemas/Token" },
    {
      type: "object",
      properties: {
        curveSupply: {
          type: "string",
          description:
            "Virtual token-side AMM reserve (reserve0) used by the bonding curve's constant-product math, raw 18 decimals. This is NOT the real remaining curve balance: it starts at TOTAL_SUPPLY (1B * 1e18) and floors at LP_RESERVE (250M * 1e18) at full sellout. To derive the real remaining curve supply, subtract LP_RESERVE. Consumers that just want graduation progress should use `curveFilled` instead of recomputing.",
        },
        ltReserve: {
          type: "string",
          description:
            "Virtual LT-side AMM reserve (reserve1) used by the bonding curve's constant-product math, raw 18 decimals. This is NOT a real LT balance: it includes the launch-time virtual LT seed (~$3K worth at launch-time LT rate). Consumers that just want graduation progress should use `curveFilled` / `curveFilledOrganic` / `curveFilledLeverageBoost` instead of recomputing.",
        },
        curveFilled: { type: "number", nullable: true, description: "Percentage of curve filled (0-100). USD-denominated: `realLt × currentRate / graduationThresholdUsd × 100`, clamped to [0, 100]. Falls back to supply-based progress when `k` / rate / `ltReserve` are unavailable so the bar stays populated during indexer or BounceTech outages. `null` when neither path can be derived (e.g. the indexer is unreachable for this token and `curveSupply` is null) — clients must render '—', never `0`." },
        curveFilledOrganic: { type: "number", nullable: true, description: "Portion of `curveFilled` attributable to organic USDC buys. `null` while indexer/BounceTech are degraded or post-graduation." },
        curveFilledLeverageBoost: { type: "number", nullable: true, description: "Portion of `curveFilled` attributable to LT price appreciation. Clamped at 0 when the LT has dropped (we never surface a negative boost on the UI)." },
        curveRaisedUsd: { type: "number", nullable: true, description: "Live USD value of the curve's real LT reserve (`realLt × currentRate`). Numerator behind `curveFilled`; surfaced separately so clients can render the absolute '$X raised' label without redoing the virtual→real LT subtraction. `null` when degraded or post-graduation." },
      },
    },
  ],
};

const tradeSchema = {
  type: "object" as const,
  properties: {
    id: { type: "string" },
    tokenAddress: { type: "string" },
    trader: { type: "string" },
    isBuy: { type: "boolean" },
    usdcAmount: { type: "string", description: "USDC amount in raw units (6 decimals)" },
    tokenAmount: { type: "string", description: "Token amount in raw units (18 decimals)" },
    blockNumber: { type: "string" },
    timestamp: { type: "string" },
  },
};

const candleSchema = {
  type: "object" as const,
  properties: {
    time: { type: "integer", description: "Unix timestamp of the candle bucket" },
    open: { type: "number" },
    high: { type: "number" },
    low: { type: "number" },
    close: { type: "number" },
    volume: { type: "number", description: "USDC volume" },
  },
};

const holderSchema = {
  type: "object" as const,
  properties: {
    wallet: { type: "string" },
    balance: { type: "string", description: "Raw token balance (18 decimals)" },
    percentage: { type: "number", description: "Percentage of total supply held" },
  },
};

const apiKeyHeader = {
  name: "X-API-Key",
  in: "header" as const,
  required: true,
  schema: { type: "string" as const },
  description: "API key for authentication. All /api/v1/* endpoints require this header. Anonymous rate limit: 60 req/min per IP.",
};

const adminKeyHeader = {
  name: "X-Admin-Key",
  in: "header" as const,
  required: true,
  schema: { type: "string" as const },
  description: "Admin API key for privileged operations",
};

const spec = {
  openapi: "3.1.0",
  info: {
    title: "Alt Fun API",
    version: "1.0.0",
    description: `Token launchpad on HyperEVM. Every token's bonding curve holds a BounceTech Leveraged Token (LT) as its reserve asset.

## Authentication

All \`/api/v1/*\` endpoints accept an optional \`X-API-Key\` header. Without a key, requests are rate-limited to 60 req/min per IP. With a key, the rate limit is configurable per key.

Admin endpoints (\`/api/v1/admin/*\`) require an \`X-Admin-Key\` header.

## Response Format

All responses use a consistent envelope:

**Success:** \`{ "status": "success", "data": <T>, "error": null }\`

**Error:** \`{ "status": "error", "data": null, "error": "<message>" }\`

Some endpoints include an optional \`dataSource\` field (\`"live"\` or \`"degraded"\`) indicating whether the on-chain indexer was available.

## WebSocket

Public, anonymous endpoint. Open one connection per \`(channel, token?)\` subject — each connection lands on its own subject-sharded \`WebSocketDO\` and receives only that subject's events.

**Connect:** \`WSS /ws?channel=<name>&token=<addr?>\`

**Channels:**
- \`trade\` — New trades. Per-token; omit \`token\` to subscribe to the global wildcard feed.
- \`price\` — LT exchange-rate ticks. Per-LT (\`token\` is the LT contract address).
- \`graduation\` — Token graduated. Per-token (or wildcard).
- \`newToken\` — New token launches. Global (\`token\` ignored).
- \`stats\` — Platform stats updates. Global (\`token\` ignored).

**Keep-alive:** clients may send \`{ "type": "ping" }\` and will receive \`{ "type": "pong" }\`. The server also pings idle connections.

**Message format:** \`{ "channel": "<channel>", "data": <payload> }\`

Per-IP connection limits (10 concurrent across the fleet) are enforced before the upgrade.
`,
  },
  servers: [
    { url: "/", description: "Current server" },
  ],
  tags: [
    { name: "Tokens", description: "Token listing, search, details, and creation" },
    { name: "Trades", description: "Trade history, OHLCV charts, and sparklines" },
    { name: "Creators", description: "Creator profiles and stats" },
    { name: "Portfolio", description: "Wallet portfolio and holdings" },
    { name: "Stats", description: "Global platform statistics" },
    { name: "Assets", description: "Underlying assets and leveraged tokens" },
    { name: "Holders", description: "Token holder rankings" },
    { name: "Security", description: "Token security information" },
    { name: "Referrals", description: "Referral tracking" },
    { name: "Images", description: "Image upload and serving" },
    { name: "Admin", description: "Admin operations (requires X-Admin-Key)" },
    { name: "Moderation", description: "Wallet-signed moderation actions (token hide / unhide). Auth via EIP-191 signature recovered to an address in the admin allowlist — see `routes/moderation.ts`." },
  ],
  components: {
    schemas: {
      Token: tokenSchema,
      TokenDetail: tokenDetailSchema,
      Trade: tradeSchema,
      Candle: candleSchema,
      Holder: holderSchema,
      ErrorResponse: errorResponse,
    },
    securitySchemes: {
      ApiKeyAuth: {
        type: "apiKey",
        in: "header",
        name: "X-API-Key",
        description: "API key for rate-limited access to all /api/v1/* endpoints",
      },
      AdminKeyAuth: {
        type: "apiKey",
        in: "header",
        name: "X-Admin-Key",
        description: "Admin API key for privileged operations",
      },
    },
  },
  security: [{ ApiKeyAuth: [] }],
  paths: {
    // ─── Tokens ─────────────────────────────────────────────
    "/api/v1/tokens": {
      get: {
        tags: ["Tokens"],
        summary: "List tokens",
        description: "Returns a paginated list of tokens with optional filters for underlying asset, status, direction, leverage, and creator.",
        parameters: [
          ...paginationParams,
          { name: "underlying", in: "query", schema: { type: "string", enum: UNDERLYING_ENUM }, description: "Filter by underlying asset. The `xyz:` namespace covers BounceTech's equity / commodity perps (S&P 500, NVDA, Gold, etc.); the rest are Hyperliquid spot/perps." },
          { name: "status", in: "query", schema: { type: "string", enum: ["curve", "graduating", "graduated"] }, description: "Filter by lifecycle status. `graduated` is backed by the indexer's `graduated` flag (ordered `graduatedAt desc`); `graduating` is indexer-backed too and includes non-graduated tokens whose virtual `curveSupply` has dropped below the 90%-filled threshold, ordered closest-to-graduation first. Both ignore `sort` / `dir`. `curve` is Postgres-backed and respects `sort`." },
          { name: "direction", in: "query", schema: { type: "string", enum: ["long", "short"] }, description: "Filter by LT direction" },
          { name: "leverage", in: "query", schema: { type: "integer", enum: [2, 3, 5] }, description: "Filter by leverage multiplier" },
          { name: "creator", in: "query", schema: { type: "string", pattern: "^0x[a-fA-F0-9]{40}$" }, description: "Filter by creator address" },
          { name: "createdAfter", in: "query", schema: { type: "string", format: "date-time" }, description: "Return only tokens created strictly after this ISO-8601 timestamp. Cursor-style backfill: a client tracking the most recent `createdAt` it's processed can pass that value here to receive everything newer without re-receiving the boundary row." },
          { name: "sort", in: "query", schema: { type: "string", enum: ["createdAt", "leverage", "name", "trending"], default: "createdAt" }, description: "Sort field. `trending` ranks tokens by rolling 24h gross USDC volume (sole signal — no precomputed score, no boost, no freshness/recency heuristics). Tie-break on mcap desc. Ignores `dir`, always returns highest-volume first, and is capped at the 500 highest-volume tokens matching the filters." },
          { name: "dir", in: "query", schema: { type: "string", enum: ["asc", "desc"], default: "desc" }, description: "Sort direction" },
          apiKeyHeader,
        ],
        responses: {
          "200": {
            description: "List of tokens with on-chain enrichment (curve state, USD raised, USD-denominated graduation progress, organic-vs-leverage split). Same shape as `GET /api/v1/tokens/{address}`.",
            content: { "application/json": { schema: successResponse({ type: "array", items: { $ref: "#/components/schemas/TokenDetail" } }) } },
          },
          "400": { description: "Invalid pagination or `createdAfter` parameter", content: { "application/json": { schema: errorResponse } } },
        },
      },
      post: {
        tags: ["Tokens"],
        summary: "Register an on-chain token",
        description:
          "Idempotent off-chain registration of a token that has already been launched on-chain. Reads `name`, `ticker`, `description`, `image`, `urls`, `creator`, and `ltAddress` directly from `Bonding.getTokenInfo` server-side, validates the image URL points at the Alt Fun image bucket, derives `underlying` / `leverage` / `direction` from the BounceTech LT directory, and inserts the row. **No signature** required: the on-chain `TokenInfo` is the source of truth, so any caller produces the same row. Idempotent — concurrent calls (frontend post-tx + cron backfill) collapse to a single insert.",
        parameters: [apiKeyHeader],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["address"],
                properties: {
                  address: {
                    type: "string",
                    pattern: "^0x[a-fA-F0-9]{40}$",
                    description: "Token contract address (returned by `Zap.TokenCreated`).",
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Token already registered (returns the existing row)", content: { "application/json": { schema: successResponse({ $ref: "#/components/schemas/Token" }) } } },
          "201": { description: "Token registered", content: { "application/json": { schema: successResponse({ $ref: "#/components/schemas/Token" }) } } },
          "400": { description: "Invalid address", content: { "application/json": { schema: errorResponse } } },
          "404": { description: "Token not found on-chain", content: { "application/json": { schema: errorResponse } } },
          "422": { description: "Image URL or LT failed validation", content: { "application/json": { schema: errorResponse } } },
          "500": { description: "Internal error during registration (e.g. DB write race that couldn't be re-resolved)", content: { "application/json": { schema: errorResponse } } },
          "502": { description: "Upstream RPC or BounceTech directory unavailable", content: { "application/json": { schema: errorResponse } } },
        },
      },
    },

    "/api/v1/tokens/search": {
      get: {
        tags: ["Tokens"],
        summary: "Search tokens",
        description: "Search tokens by name, ticker, or address. Returns up to 20 results.",
        parameters: [
          { name: "q", in: "query", required: true, schema: { type: "string", minLength: 1 }, description: "Search query" },
          apiKeyHeader,
        ],
        responses: {
          "200": {
            description: "Matching tokens",
            content: { "application/json": { schema: successResponse({ type: "array", items: { $ref: "#/components/schemas/Token" } }) } },
          },
        },
      },
    },

    "/api/v1/tokens/batch": {
      post: {
        tags: ["Tokens"],
        summary: "Batch fetch tokens",
        description: "Fetch multiple tokens by address in a single request. Maximum 100 addresses.",
        parameters: [apiKeyHeader],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["addresses"],
                properties: {
                  addresses: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 100 },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Matching tokens",
            content: { "application/json": { schema: successResponse({ type: "array", items: { $ref: "#/components/schemas/Token" } }) } },
          },
          "400": { description: "Validation error", content: { "application/json": { schema: errorResponse } } },
        },
      },
    },

    "/api/v1/tokens/{address}": {
      get: {
        tags: ["Tokens"],
        summary: "Get token details",
        description:
          "Returns full token details including on-chain data from the indexer (curve supply, LT reserve, graduation progress).\n\nHidden tokens (admin-moderated via `/moderation/tokens/{address}/hide`) return 404 to the public lens. A connected wallet that already holds the token can supply `?wallet=<address>` to receive the row with `isHidden: true` so it can sell its position from the UI — the server verifies ownership with a single on-chain `balanceOf` read and refuses to disclose the row when the balance is zero (issue #712).",
        parameters: [
          addressParam("address", "Token contract address"),
          {
            name: "wallet",
            in: "query" as const,
            required: false,
            schema: { type: "string" as const, pattern: "^0x[a-fA-F0-9]{40}$" },
            description:
              "Optional connected-wallet address. When set AND the wallet currently holds a non-zero balance of an admin-hidden token, the endpoint returns the row with `isHidden: true` so the holder can sell. Ignored for non-hidden tokens (their normal 200 response is returned). Wallet-aware responses are NEVER cached at the edge — pass the param explicitly per request.",
          },
          apiKeyHeader,
        ],
        responses: {
          "200": {
            description: "Token details with on-chain data",
            content: { "application/json": { schema: successResponse({ $ref: "#/components/schemas/TokenDetail" }, true) } },
          },
          "400": { description: "Invalid address", content: { "application/json": { schema: errorResponse } } },
          "404": { description: "Token not found", content: { "application/json": { schema: errorResponse } } },
        },
      },
    },

    // ─── Trades ─────────────────────────────────────────────
    "/api/v1/trades": {
      get: {
        tags: ["Trades"],
        summary: "List recent trades",
        description: "Returns the most recent trades across all tokens. Supports `offset` for paginating backwards through history (newest-first ordering).",
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 50 }, description: "Maximum number of trades" },
          { name: "offset", in: "query", schema: { type: "integer", minimum: 0, default: 0 }, description: "Number of trades to skip (for pagination)" },
          apiKeyHeader,
        ],
        responses: {
          "200": {
            description: "List of trades",
            content: { "application/json": { schema: successResponse({ type: "array", items: { $ref: "#/components/schemas/Trade" } }) } },
          },
          "400": { description: "Invalid pagination", content: { "application/json": { schema: errorResponse } } },
          "503": { description: "Indexer unavailable", content: { "application/json": { schema: errorResponse } } },
        },
      },
    },

    "/api/v1/trades/{address}": {
      get: {
        tags: ["Trades"],
        summary: "List trades for a token",
        description: "Returns paginated trade history for a specific token.",
        parameters: [
          addressParam("address", "Token contract address"),
          ...paginationParams,
          apiKeyHeader,
        ],
        responses: {
          "200": {
            description: "List of trades",
            content: { "application/json": { schema: successResponse({ type: "array", items: { $ref: "#/components/schemas/Trade" } }) } },
          },
          "400": { description: "Invalid address or pagination", content: { "application/json": { schema: errorResponse } } },
          "503": { description: "Indexer unavailable", content: { "application/json": { schema: errorResponse } } },
        },
      },
    },

    "/api/v1/trades/ohlcv/{address}": {
      get: {
        tags: ["Trades"],
        summary: "Get OHLCV candle data",
        description: "Returns OHLCV (Open/High/Low/Close/Volume) candle data for charting.",
        parameters: [
          addressParam("address", "Token contract address"),
          { name: "interval", in: "query", schema: { type: "string", enum: ["1m", "5m", "15m", "1h", "4h"], default: "5m" }, description: "Candle interval" },
          apiKeyHeader,
        ],
        responses: {
          "200": {
            description: "Array of OHLCV candles",
            content: { "application/json": { schema: successResponse({ type: "array", items: { $ref: "#/components/schemas/Candle" } }) } },
          },
          "400": { description: "Invalid address or interval", content: { "application/json": { schema: errorResponse } } },
          "503": { description: "Indexer unavailable", content: { "application/json": { schema: errorResponse } } },
        },
      },
    },

    "/api/v1/trades/sparkline/{address}": {
      get: {
        tags: ["Trades"],
        summary: "Get price sparkline",
        description: "Returns sampled price points for a mini chart. Useful for token list views.",
        parameters: [
          addressParam("address", "Token contract address"),
          { name: "points", in: "query", schema: { type: "integer", minimum: 1, maximum: 50, default: 20 }, description: "Number of data points" },
          apiKeyHeader,
        ],
        responses: {
          "200": {
            description: "Array of price values (oldest first)",
            content: { "application/json": { schema: successResponse({ type: "array", items: { type: "number" } }) } },
          },
          "400": { description: "Invalid address", content: { "application/json": { schema: errorResponse } } },
        },
      },
    },

    // ─── Creators ───────────────────────────────────────────
    "/api/v1/creators/{address}": {
      get: {
        tags: ["Creators"],
        summary: "Get creator profile",
        description: "Returns creator profile, their tokens, and aggregate stats (total volume, tokens created).",
        parameters: [addressParam("address", "Creator wallet address"), apiKeyHeader],
        responses: {
          "200": {
            description: "Creator profile and stats",
            content: {
              "application/json": {
                schema: successResponse({
                  type: "object",
                  properties: {
                    profile: {
                      type: "object",
                      nullable: true,
                      properties: {
                        address: { type: "string" },
                        displayName: { type: "string", nullable: true },
                        bio: { type: "string", nullable: true },
                        twitterUrl: { type: "string", nullable: true, description: "Twitter / X handle (no `@`, no URL prefix). Frontend builds the link via `buildTwitterUrl`." },
                        totalVolume: { type: "string" },
                        totalTrades: { type: "integer" },
                        updatedAt: { type: "string", format: "date-time" },
                      },
                    },
                    tokens: { type: "array", items: { $ref: "#/components/schemas/Token" } },
                    stats: {
                      type: "object",
                      properties: {
                        tokensCreated: { type: "integer" },
                        totalVolume: { type: "string", description: "Total USDC volume in raw units" },
                      },
                    },
                  },
                }),
              },
            },
          },
          "400": { description: "Invalid address", content: { "application/json": { schema: errorResponse } } },
        },
      },
    },

    // ─── Portfolio ──────────────────────────────────────────
    "/api/v1/portfolio/{wallet}": {
      get: {
        tags: ["Portfolio"],
        summary: "Get wallet portfolio",
        description:
          "Returns all token positions for a wallet. `tokenAmount` is the wallet's true on-chain balance (sourced from the indexer's `tokenBalance` index — reflects every ERC-20 Transfer, not just Zap activity). `costBasisUsdc` is sourced from the per-(wallet, token) `walletPosition` row that's bumped on every Zap buy/sell with proportional reduction; tokens received via direct Transfer correctly show a non-zero `tokenAmount` with `costBasisUsdc: \"0\"`.",
        parameters: [addressParam("wallet", "Wallet address"), apiKeyHeader],
        responses: {
          "200": {
            description: "Portfolio positions",
            content: {
              "application/json": {
                schema: successResponse({
                  type: "object",
                  properties: {
                    positions: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          tokenAddress: { type: "string" },
                          tokenAmount: { type: "string", description: "Raw token balance (18 decimals)" },
                          costBasisUsdc: { type: "string", description: "Cumulative USDC paid (6 decimals), reduced proportionally on each sell. `0` for tokens acquired only via direct Transfer." },
                        },
                      },
                    },
                    approximate: { type: "boolean", description: "True only when the wallet holds more than 1000 distinct tokens (degenerate case). Cap exists to bound the query — callers in this regime should use on-chain `balanceOf` multicall instead." },
                  },
                }),
              },
            },
          },
          "400": { description: "Invalid wallet address", content: { "application/json": { schema: errorResponse } } },
          "503": { description: "Indexer unavailable", content: { "application/json": { schema: errorResponse } } },
        },
      },
    },

    // ─── Stats ──────────────────────────────────────────────
    "/api/v1/stats": {
      get: {
        tags: ["Stats"],
        summary: "Get global platform stats",
        description: "Returns aggregate platform statistics including token counts and 24h volume.",
        parameters: [apiKeyHeader],
        responses: {
          "200": {
            description: "Platform statistics",
            content: {
              "application/json": {
                schema: successResponse({
                  type: "object",
                  properties: {
                    tokensLive: { type: "integer", description: "Tokens currently on bonding curve" },
                    tokensGraduated: { type: "integer", description: "Tokens that have graduated to HyperSwap" },
                    totalTokens: { type: "integer" },
                    volume24h: { type: "string", description: "24h USDC volume in raw units (6 decimals)" },
                  },
                }, true),
              },
            },
          },
        },
      },
    },

    // ─── Assets ─────────────────────────────────────────────
    "/api/v1/assets": {
      get: {
        tags: ["Assets"],
        summary: "Get supported assets and leveraged tokens",
        description:
          "Returns underlying assets and BounceTech Leveraged Tokens that are currently live on BounceTech's UI (per the per-LT logo at `https://bounce.tech/leveraged-tokens/<symbol>.png`). Tokens BounceTech has deployed for internal testing — i.e. live on-chain but not yet surfaced in their web app — are filtered out (issue #621). LT-availability is refreshed every minute by the API Worker's cron handler. Spot prices are cached for 10 seconds; the asset/LT filter set is cached for ~5 minutes.",
        parameters: [apiKeyHeader],
        responses: {
          "200": {
            description: "Assets and leveraged tokens",
            content: {
              "application/json": {
                schema: successResponse({
                  type: "object",
                  properties: {
                    underlying: {
                      type: "array",
                      description:
                        "Underlying assets with at least one live BounceTech LT. Drives the markets sidebar + asset tape on Alt Fun.",
                      items: {
                        type: "object",
                        properties: {
                          symbol: { type: "string", example: "HYPE" },
                          price: { type: "string", nullable: true, description: "Spot price from Hyperliquid" },
                        },
                      },
                    },
                    leveragedTokens: {
                      type: "array",
                      description:
                        "Leveraged tokens BounceTech has published on their UI. Pairs that exist on-chain but haven't been published yet are filtered out.",
                      items: {
                        type: "object",
                        properties: {
                          address: { type: "string" },
                          symbol: { type: "string", example: "HYPE3L" },
                          name: { type: "string" },
                          targetAsset: { type: "string" },
                          targetLeverage: { type: "integer" },
                          isLong: { type: "boolean" },
                          exchangeRate: { type: "string", description: "USD per LT unit (18 decimals)" },
                          mintPaused: { type: "boolean" },
                        },
                      },
                    },
                    liveUnderlyings: {
                      type: "array",
                      description:
                        "Lightweight list of underlying-asset symbols (e.g. `HYPE`, `xyz:NVDA`) that currently have ≥1 live LT. Surfaced for clients (markets sidebar, asset tape, pair selector) that only need the filter set, not the per-LT payload. Falls back to the full supported list when BounceTech's UI is unreachable during a cold start.",
                      items: { type: "string", enum: UNDERLYING_ENUM },
                    },
                  },
                }),
              },
            },
          },
        },
      },
    },

    // ─── Holders ────────────────────────────────────────────
    "/api/v1/holders/{address}": {
      get: {
        tags: ["Holders"],
        summary: "Get token holders",
        description: "Returns top holders for a token ranked by balance. Computed from trade history.",
        parameters: [
          addressParam("address", "Token contract address"),
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 }, description: "Number of top holders" },
          apiKeyHeader,
        ],
        responses: {
          "200": {
            description: "Token holders",
            content: {
              "application/json": {
                schema: successResponse({
                  type: "object",
                  properties: {
                    holders: { type: "array", items: { $ref: "#/components/schemas/Holder" } },
                    totalHolders: { type: "integer" },
                    approximate: { type: "boolean", description: "True if trade history was truncated" },
                  },
                }),
              },
            },
          },
          "400": { description: "Invalid address or pagination", content: { "application/json": { schema: errorResponse } } },
          "503": { description: "Indexer unavailable", content: { "application/json": { schema: errorResponse } } },
        },
      },
    },

    // ─── Security ───────────────────────────────────────────
    "/api/v1/security/{address}": {
      get: {
        tags: ["Security"],
        summary: "Get token security info",
        description: "Returns security-related information: LP lock status, creator holdings, graduation status.",
        parameters: [addressParam("address", "Token contract address"), apiKeyHeader],
        responses: {
          "200": {
            description: "Security information",
            content: {
              "application/json": {
                schema: successResponse({
                  type: "object",
                  properties: {
                    lpLocked: { type: "boolean", description: "Whether LP tokens are locked" },
                    lpAmount: { type: "string", nullable: true, description: "LP liquidity amount" },
                    creatorHoldingPct: { type: "number", description: "Creator's current holding as percentage of total supply. Sourced from the indexer's `tokenBalance` index — reflects every ERC-20 Transfer, not just Zap activity." },
                    contractVerified: { type: "boolean" },
                    graduated: { type: "boolean" },
                    poolAddress: { type: "string", nullable: true },
                  },
                }),
              },
            },
          },
          "400": { description: "Invalid address", content: { "application/json": { schema: errorResponse } } },
        },
      },
    },

    // ─── Referrals ──────────────────────────────────────────
    "/api/v1/referrals-v2/{wallet}": {
      get: {
        tags: ["Referrals"],
        summary: "Get referral data",
        description: "Returns referral statistics and history for a wallet.",
        parameters: [addressParam("wallet", "Referrer wallet address"), apiKeyHeader],
        responses: {
          "200": {
            description: "Referral data",
            content: {
              "application/json": {
                schema: successResponse({
                  type: "object",
                  properties: {
                    referredWallets: { type: "integer", description: "Number of unique referred wallets" },
                    referredVolume: { type: "string", description: "Total USDC volume from referrals (raw, 6 decimals)" },
                    referrals: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          tokenAddress: { type: "string" },
                          trader: { type: "string" },
                          usdcAmount: { type: "string" },
                          timestamp: { type: "string" },
                        },
                      },
                    },
                  },
                }),
              },
            },
          },
          "400": { description: "Invalid wallet address", content: { "application/json": { schema: errorResponse } } },
        },
      },
    },

    // ─── Images ─────────────────────────────────────────────
    "/api/v1/images": {
      post: {
        tags: ["Images"],
        summary: "Upload an image",
        description: "Upload a token image. Accepts JPEG, PNG, GIF, or WebP. Max 5MB. Images are scanned for prohibited content before storage.",
        parameters: [apiKeyHeader],
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                required: ["file"],
                properties: {
                  file: { type: "string", format: "binary", description: "Image file (JPEG, PNG, GIF, WebP, max 5MB)" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Image uploaded successfully",
            content: {
              "application/json": {
                schema: successResponse({
                  type: "object",
                  properties: {
                    url: { type: "string", description: "Relative URL to access the image" },
                    key: { type: "string", description: "R2 storage key" },
                    flaggedForReview: { type: "boolean", description: "True if the image was flagged for manual review" },
                  },
                }),
              },
            },
          },
          "400": { description: "Invalid file type or no file uploaded", content: { "application/json": { schema: errorResponse } } },
          "422": { description: "Image rejected by content moderation", content: { "application/json": { schema: errorResponse } } },
          "503": { description: "Image moderation unavailable", content: { "application/json": { schema: errorResponse } } },
        },
      },
    },

    "/api/v1/images/{prefix}/{key}": {
      get: {
        tags: ["Images"],
        summary: "Get an image",
        description: "Serve a previously uploaded image. Responses are cached for 1 year.",
        parameters: [
          { name: "prefix", in: "path", required: true, schema: { type: "string" }, description: "Image path prefix" },
          { name: "key", in: "path", required: true, schema: { type: "string" }, description: "Image filename" },
        ],
        responses: {
          "200": {
            description: "Image binary",
            content: {
              "image/*": { schema: { type: "string", format: "binary" } },
            },
          },
          "404": { description: "Image not found", content: { "application/json": { schema: errorResponse } } },
        },
      },
    },

    // ─── Admin ──────────────────────────────────────────────
    "/api/v1/admin/tokens/{address}/hide": {
      post: {
        tags: ["Admin"],
        summary: "Hide a token",
        description: "Hide a token from public listing.",
        security: [{ AdminKeyAuth: [] }],
        parameters: [addressParam("address", "Token contract address"), apiKeyHeader, adminKeyHeader],
        responses: {
          "200": { description: "Token hidden", content: { "application/json": { schema: successResponse({ type: "object", properties: { hidden: { type: "boolean" } } }) } } },
          "400": { description: "Invalid address", content: { "application/json": { schema: errorResponse } } },
          "401": { description: "Unauthorized", content: { "application/json": { schema: errorResponse } } },
        },
      },
    },

    "/api/v1/admin/tokens/{address}/unhide": {
      post: {
        tags: ["Admin"],
        summary: "Unhide a token",
        description: "Restore a hidden token to public listing.",
        security: [{ AdminKeyAuth: [] }],
        parameters: [addressParam("address", "Token contract address"), apiKeyHeader, adminKeyHeader],
        responses: {
          "200": { description: "Token unhidden", content: { "application/json": { schema: successResponse({ type: "object", properties: { hidden: { type: "boolean" } } }) } } },
          "400": { description: "Invalid address", content: { "application/json": { schema: errorResponse } } },
          "401": { description: "Unauthorized", content: { "application/json": { schema: errorResponse } } },
        },
      },
    },

    // ─── Wallet-signed moderation (issue #586) ────────────────
    //
    // These endpoints sit alongside the `X-Admin-Key`-gated `/admin/...`
    // moderation routes. The shared-secret variant is for ops scripts;
    // this variant lets the front-end UI do moderation directly from a
    // connected wallet by signing an EIP-191 message with the admin
    // wallet itself. Allowlist comes from `ADMIN_WALLETS` (env, comma
    // separated) with a fallback to `DEFAULT_ADMIN_WALLETS` baked into
    // `@launchpad/shared`.
    "/api/v1/moderation/admins/{address}": {
      get: {
        tags: ["Moderation"],
        summary: "Check whether a wallet is an admin",
        description: "Returns `{ isAdmin: true }` if the supplied wallet is currently configured as a moderation admin. Public endpoint — used by the UI to decide whether to render the admin button. Returns the boolean for one address only; never enumerates the allowlist.",
        parameters: [addressParam("address", "Wallet address to check"), apiKeyHeader],
        responses: {
          "200": {
            description: "Admin status",
            content: {
              "application/json": {
                schema: successResponse({
                  type: "object",
                  properties: {
                    address: { type: "string", description: "Checksummed copy of the requested address." },
                    isAdmin: { type: "boolean" },
                  },
                  required: ["address", "isAdmin"],
                }),
              },
            },
          },
          "400": { description: "Invalid address", content: { "application/json": { schema: errorResponse } } },
        },
      },
    },

    "/api/v1/moderation/tokens/{address}/hide": {
      post: {
        tags: ["Moderation"],
        summary: "Hide a token (wallet-signed)",
        description: "Hide a token from public listings. Authenticated by the same 24-hour session signature flow as `PUT /api/v1/profiles/:address` — the admin signs `buildSessionMessage(address, expiresAt)` once per day; the resulting signature is reused for every moderation call. Server recovers the signer via EIP-191, requires the recovered address to match the claimed `address`, and checks that address against the admin allowlist (`ADMIN_WALLETS` env, falling back to `DEFAULT_ADMIN_WALLETS` from `@launchpad/shared`).",
        parameters: [addressParam("address", "Token contract address"), apiKeyHeader],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["address", "signature", "expiresAt"],
                properties: {
                  address: { type: "string", description: "Admin wallet address. Must match the recovered signer." },
                  signature: { type: "string", description: "Hex-encoded EIP-191 signature of `buildSessionMessage(address, expiresAt)`." },
                  expiresAt: { type: "integer", description: "Unix-ms expiry baked into the signed message; must lie within the session-duration window from now." },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Token hidden",
            content: {
              "application/json": {
                schema: successResponse({
                  type: "object",
                  properties: {
                    address: { type: "string" },
                    isHidden: { type: "boolean" },
                    admin: { type: "string", description: "Recovered admin wallet that authorised the action." },
                  },
                  required: ["address", "isHidden", "admin"],
                }),
              },
            },
          },
          "400": { description: "Invalid address or body", content: { "application/json": { schema: errorResponse } } },
          "401": { description: "Signature missing, expired, or not from an admin wallet", content: { "application/json": { schema: errorResponse } } },
          "404": { description: "Token not found in registry", content: { "application/json": { schema: errorResponse } } },
        },
      },
    },

    "/api/v1/moderation/tokens/{address}/unhide": {
      post: {
        tags: ["Moderation"],
        summary: "Unhide a token (wallet-signed)",
        description: "Restore a hidden token to public listings. Same auth model as `/hide` — see that endpoint for the signature requirements.",
        parameters: [addressParam("address", "Token contract address"), apiKeyHeader],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["address", "signature", "expiresAt"],
                properties: {
                  address: { type: "string", description: "Admin wallet address. Must match the recovered signer." },
                  signature: { type: "string", description: "Hex-encoded EIP-191 signature of `buildSessionMessage(address, expiresAt)`." },
                  expiresAt: { type: "integer", description: "Unix-ms expiry baked into the signed message." },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Token unhidden",
            content: {
              "application/json": {
                schema: successResponse({
                  type: "object",
                  properties: {
                    address: { type: "string" },
                    isHidden: { type: "boolean" },
                    admin: { type: "string" },
                  },
                  required: ["address", "isHidden", "admin"],
                }),
              },
            },
          },
          "400": { description: "Invalid address or body", content: { "application/json": { schema: errorResponse } } },
          "401": { description: "Signature missing, expired, or not from an admin wallet", content: { "application/json": { schema: errorResponse } } },
          "404": { description: "Token not found in registry", content: { "application/json": { schema: errorResponse } } },
        },
      },
    },

    "/api/v1/admin/analytics/dau": {
      get: {
        tags: ["Admin"],
        summary: "Daily active users",
        description: "Returns daily active user counts for the specified period.",
        security: [{ AdminKeyAuth: [] }],
        parameters: [
          { name: "days", in: "query", schema: { type: "integer", minimum: 1, maximum: 365, default: 30 }, description: "Number of days to look back" },
          apiKeyHeader,
          adminKeyHeader,
        ],
        responses: {
          "200": {
            description: "DAU time series",
            content: {
              "application/json": {
                schema: successResponse({
                  type: "object",
                  properties: {
                    series: { type: "array", items: { type: "object", properties: { date: { type: "string" }, value: { type: "number" } } } },
                    truncated: { type: "boolean" },
                  },
                }),
              },
            },
          },
        },
      },
    },

    "/api/v1/admin/analytics/volume": {
      get: {
        tags: ["Admin"],
        summary: "Daily volume",
        description: "Returns daily USDC volume for the specified period.",
        security: [{ AdminKeyAuth: [] }],
        parameters: [
          { name: "days", in: "query", schema: { type: "integer", minimum: 1, maximum: 365, default: 30 }, description: "Number of days" },
          apiKeyHeader,
          adminKeyHeader,
        ],
        responses: {
          "200": {
            description: "Volume time series",
            content: {
              "application/json": {
                schema: successResponse({
                  type: "object",
                  properties: {
                    series: { type: "array", items: { type: "object", properties: { date: { type: "string" }, value: { type: "number" } } } },
                    truncated: { type: "boolean" },
                  },
                }),
              },
            },
          },
        },
      },
    },

    "/api/v1/admin/analytics/graduations": {
      get: {
        tags: ["Admin"],
        summary: "Graduation analytics",
        description: "Returns graduation stats: daily graduations, launches, graduation rate, average time to graduation.",
        security: [{ AdminKeyAuth: [] }],
        parameters: [
          { name: "days", in: "query", schema: { type: "integer", minimum: 1, maximum: 365, default: 30 }, description: "Number of days" },
          apiKeyHeader,
          adminKeyHeader,
        ],
        responses: {
          "200": {
            description: "Graduation analytics",
            content: {
              "application/json": {
                schema: successResponse({
                  type: "object",
                  properties: {
                    daily: { type: "array", items: { type: "object", properties: { date: { type: "string" }, value: { type: "number" } } } },
                    launches: { type: "array", items: { type: "object", properties: { date: { type: "string" }, value: { type: "number" } } } },
                    totalLaunches: { type: "integer" },
                    totalGraduations: { type: "integer" },
                    graduationRate: { type: "number" },
                    avgTimeToGraduationSeconds: { type: "integer", nullable: true },
                    truncated: { type: "boolean" },
                  },
                }),
              },
            },
          },
        },
      },
    },

    "/api/v1/admin/analytics/revenue": {
      get: {
        tags: ["Admin"],
        summary: "Revenue analytics",
        description: "Returns daily protocol and creator revenue for the specified period.",
        security: [{ AdminKeyAuth: [] }],
        parameters: [
          { name: "days", in: "query", schema: { type: "integer", minimum: 1, maximum: 365, default: 30 }, description: "Number of days" },
          apiKeyHeader,
          adminKeyHeader,
        ],
        responses: {
          "200": {
            description: "Revenue time series",
            content: {
              "application/json": {
                schema: successResponse({
                  type: "object",
                  properties: {
                    protocol: { type: "array", items: { type: "object", properties: { date: { type: "string" }, value: { type: "number" } } } },
                    creator: { type: "array", items: { type: "object", properties: { date: { type: "string" }, value: { type: "number" } } } },
                    truncated: { type: "boolean" },
                  },
                }),
              },
            },
          },
        },
      },
    },

    "/api/v1/admin/moderation/pending": {
      get: {
        tags: ["Admin"],
        summary: "List pending moderation items",
        description: "Returns images flagged for manual review.",
        security: [{ AdminKeyAuth: [] }],
        parameters: [apiKeyHeader, adminKeyHeader],
        responses: {
          "200": {
            description: "Pending moderation items",
            content: {
              "application/json": {
                schema: successResponse({
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "integer" },
                      imageKey: { type: "string" },
                      decision: { type: "string" },
                      reason: { type: "string" },
                      classifications: { type: "string", description: "JSON array of {label, score}" },
                      reviewedBy: { type: "string", nullable: true },
                      reviewedAt: { type: "string", format: "date-time", nullable: true },
                      createdAt: { type: "string", format: "date-time" },
                    },
                  },
                }),
              },
            },
          },
        },
      },
    },

    "/api/v1/admin/moderation/logs": {
      get: {
        tags: ["Admin"],
        summary: "List moderation logs",
        description: "Returns recent moderation decisions (approved, rejected, pending).",
        security: [{ AdminKeyAuth: [] }],
        parameters: [apiKeyHeader, adminKeyHeader],
        responses: {
          "200": {
            description: "Moderation logs",
            content: {
              "application/json": {
                schema: successResponse({
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "integer" },
                      imageKey: { type: "string" },
                      decision: { type: "string" },
                      reason: { type: "string" },
                      classifications: { type: "string" },
                      reviewedBy: { type: "string", nullable: true },
                      reviewedAt: { type: "string", format: "date-time", nullable: true },
                      createdAt: { type: "string", format: "date-time" },
                    },
                  },
                }),
              },
            },
          },
        },
      },
    },

    "/api/v1/admin/moderation/{id}/approve": {
      post: {
        tags: ["Admin"],
        summary: "Approve moderation item",
        description: "Approve a flagged image.",
        security: [{ AdminKeyAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "integer" }, description: "Moderation log ID" },
          { name: "X-Reviewer-Address", in: "header", schema: { type: "string" }, description: "Reviewer wallet address" },
          apiKeyHeader,
          adminKeyHeader,
        ],
        responses: {
          "200": { description: "Approved", content: { "application/json": { schema: successResponse({ type: "object" }) } } },
          "400": { description: "Invalid ID", content: { "application/json": { schema: errorResponse } } },
          "404": { description: "Not found", content: { "application/json": { schema: errorResponse } } },
        },
      },
    },

    "/api/v1/admin/moderation/{id}/reject": {
      post: {
        tags: ["Admin"],
        summary: "Reject moderation item",
        description: "Reject a flagged image. The image is deleted from R2.",
        security: [{ AdminKeyAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "integer" }, description: "Moderation log ID" },
          { name: "X-Reviewer-Address", in: "header", schema: { type: "string" }, description: "Reviewer wallet address" },
          apiKeyHeader,
          adminKeyHeader,
        ],
        responses: {
          "200": { description: "Rejected", content: { "application/json": { schema: successResponse({ type: "object" }) } } },
          "400": { description: "Invalid ID", content: { "application/json": { schema: errorResponse } } },
          "404": { description: "Not found", content: { "application/json": { schema: errorResponse } } },
        },
      },
    },

    "/api/v1/admin/api-keys": {
      get: {
        tags: ["Admin"],
        summary: "List API keys",
        description: "Returns all API keys (without the actual key values).",
        security: [{ AdminKeyAuth: [] }],
        parameters: [apiKeyHeader, adminKeyHeader],
        responses: {
          "200": {
            description: "List of API keys",
            content: {
              "application/json": {
                schema: successResponse({
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "integer" },
                      keyPrefix: { type: "string", description: "First 8 characters of the key" },
                      name: { type: "string" },
                      ownerAddress: { type: "string" },
                      rateLimit: { type: "integer" },
                      isActive: { type: "boolean" },
                      createdAt: { type: "string", format: "date-time" },
                    },
                  },
                }),
              },
            },
          },
        },
      },
      post: {
        tags: ["Admin"],
        summary: "Create an API key",
        description: "Generate a new API key. The full key is only returned once in the response.",
        security: [{ AdminKeyAuth: [] }],
        parameters: [apiKeyHeader, adminKeyHeader],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name", "ownerAddress"],
                properties: {
                  name: { type: "string", minLength: 1 },
                  ownerAddress: { type: "string", description: "Owner wallet address" },
                  rateLimit: { type: "integer", minimum: 1, maximum: 10000, default: 100, description: "Requests per minute" },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "API key created. The `key` field is only returned once.",
            content: {
              "application/json": {
                schema: successResponse({
                  type: "object",
                  properties: {
                    id: { type: "integer" },
                    key: { type: "string", description: "The full API key (only shown once)" },
                    name: { type: "string" },
                    rateLimit: { type: "integer" },
                  },
                }),
              },
            },
          },
          "400": { description: "Validation error", content: { "application/json": { schema: errorResponse } } },
        },
      },
    },

    "/api/v1/admin/api-keys/{id}/revoke": {
      post: {
        tags: ["Admin"],
        summary: "Revoke an API key",
        description: "Deactivate an API key.",
        security: [{ AdminKeyAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "integer" }, description: "API key ID" },
          apiKeyHeader,
          adminKeyHeader,
        ],
        responses: {
          "200": { description: "Key revoked", content: { "application/json": { schema: successResponse({ type: "object", properties: { revoked: { type: "boolean" } } }) } } },
          "400": { description: "Invalid ID", content: { "application/json": { schema: errorResponse } } },
          "404": { description: "Key not found", content: { "application/json": { schema: errorResponse } } },
        },
      },
    },

    "/api/v1/admin/api-keys/{id}/activate": {
      post: {
        tags: ["Admin"],
        summary: "Activate an API key",
        description: "Re-activate a revoked API key.",
        security: [{ AdminKeyAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "integer" }, description: "API key ID" },
          apiKeyHeader,
          adminKeyHeader,
        ],
        responses: {
          "200": { description: "Key activated", content: { "application/json": { schema: successResponse({ type: "object", properties: { activated: { type: "boolean" } } }) } } },
          "400": { description: "Invalid ID", content: { "application/json": { schema: errorResponse } } },
          "404": { description: "Key not found", content: { "application/json": { schema: errorResponse } } },
        },
      },
    },

    // ─── Webhook ────────────────────────────────────────────
    "/api/v1/webhook/indexer": {
      post: {
        tags: ["Admin"],
        summary: "Indexer webhook",
        description: "Receives events from the Ponder indexer and broadcasts them to WebSocket subscribers. Requires admin key.",
        security: [{ AdminKeyAuth: [] }],
        parameters: [adminKeyHeader],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["event", "data"],
                properties: {
                  event: { type: "string", enum: ["trade", "newToken", "graduation", "price", "stats"], description: "Event channel" },
                  data: { description: "Event payload (varies by event type)" },
                  tokenAddress: { type: "string", description: "Optional token address for token-specific events" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Event broadcasted", content: { "application/json": { schema: successResponse({ type: "object", properties: { broadcasted: { type: "boolean" } } }) } } },
          "400": { description: "Unknown event type", content: { "application/json": { schema: errorResponse } } },
          "401": { description: "Unauthorized", content: { "application/json": { schema: errorResponse } } },
        },
      },
    },
  },
} as const;

export default spec;
