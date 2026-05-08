/**
 * OpenAPI 3.1 specification for the Alt Fun API.
 *
 * Covers all /api/v1/* endpoints with request/response schemas,
 * authentication details, WebSocket protocol docs, and error formats.
 */

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
    underlying: { type: "string", enum: ["HYPE", "ETH", "BTC", "SOL"] },
    status: { type: "string", enum: ["curve", "graduating", "graduated"] },
    graduated: { type: "boolean", description: "Whether the token has graduated to HyperSwap. Derived from the on-chain curve state." },
    graduatedAt: { type: "string", format: "date-time", nullable: true },
    poolAddress: { type: "string", nullable: true, description: "HyperSwap V2 pair address after graduation" },
    bondingPair: { type: "string", nullable: true, description: "Bonding-curve pair contract address. `null` while Ponder is unavailable." },
    hyperswapPair: { type: "string", nullable: true, description: "HyperSwap V2 pair address after graduation (duplicate of `poolAddress`, kept for clients keyed on the on-chain field name)." },
    priceUsd: { type: "number", nullable: true, description: "Current token price in USD. `null` when Ponder or BounceTech is degraded — treat as unknown, never zero." },
    mcapUsd: { type: "number", nullable: true, description: "Current fully-diluted market cap in USD (`priceUsd × 1B`). `null` under the same degraded conditions as `priceUsd`." },
    change24h: { type: "number", nullable: true, description: "24h price change as a percentage. For tokens younger than 24h this is the since-launch delta. `null` when the reference price is unavailable." },
    ltChange24h: { type: "number", nullable: true, description: "24h percentage change of the backing LT's exchange rate (independent of any curve / router activity). Primary signal for the LT MOVERS tab. `null` when BounceTech has no rate at either end of the window." },
    volume24hUsd: { type: "number", nullable: true, description: "Total USD routed through `Zap` for this token in the last 24h (buys + sells). `0` = no trades in the window (legitimately quiet); `null` = indexer aggregation unavailable or truncated (unknown). Used as an input to the trending score." },
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
            "Virtual LT-side AMM reserve (reserve1) used by the bonding curve's constant-product math, raw 18 decimals. This is NOT a real LT balance: it includes the launch-time virtual LT seed (~$4K worth at launch-time LT rate). Consumers that just want graduation progress should use `curveFilled` / `curveFilledOrganic` / `curveFilledLeverageBoost` instead of recomputing.",
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

const commentSchema = {
  type: "object" as const,
  properties: {
    id: { type: "integer" },
    tokenAddress: { type: "string" },
    author: { type: "string" },
    content: { type: "string" },
    createdAt: { type: "string", format: "date-time" },
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

Connect to \`/ws\` (or \`/ws?apiKey=<key>\`) for real-time feeds.

**Subscribe:** \`{ "type": "subscribe", "channel": "<channel>", "tokenAddress": "<optional>" }\`

**Unsubscribe:** \`{ "type": "unsubscribe", "channel": "<channel>", "tokenAddress": "<optional>" }\`

**Channels:**
- \`trade\` — New trades (optionally filtered by tokenAddress)
- \`newToken\` — New token launches
- \`graduation\` — Token graduations
- \`price\` — Price updates
- \`stats\` — Global stats updates

**Message format:** \`{ "channel": "<channel>", "data": <payload>, "tokenAddress": "<optional>" }\`
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
    { name: "Comments", description: "Token comments" },
    { name: "Images", description: "Image upload and serving" },
    { name: "Admin", description: "Admin operations (requires X-Admin-Key)" },
  ],
  components: {
    schemas: {
      Token: tokenSchema,
      TokenDetail: tokenDetailSchema,
      Trade: tradeSchema,
      Candle: candleSchema,
      Comment: commentSchema,
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
          { name: "underlying", in: "query", schema: { type: "string", enum: ["HYPE", "ETH", "BTC", "SOL"] }, description: "Filter by underlying asset" },
          { name: "status", in: "query", schema: { type: "string", enum: ["curve", "graduating", "graduated"] }, description: "Filter by lifecycle status. `graduated` is backed by the indexer's `graduated` flag (ordered `graduatedAt desc`); `graduating` is indexer-backed too and includes non-graduated tokens whose virtual `curveSupply` has dropped below the 90%-filled threshold, ordered closest-to-graduation first. Both ignore `sort` / `dir`. `curve` is Postgres-backed and respects `sort`." },
          { name: "direction", in: "query", schema: { type: "string", enum: ["long", "short"] }, description: "Filter by LT direction" },
          { name: "leverage", in: "query", schema: { type: "integer", enum: [2, 3, 5] }, description: "Filter by leverage multiplier" },
          { name: "creator", in: "query", schema: { type: "string", pattern: "^0x[a-fA-F0-9]{40}$" }, description: "Filter by creator address" },
          { name: "sort", in: "query", schema: { type: "string", enum: ["createdAt", "leverage", "name", "trending", "lt-movers"], default: "createdAt" }, description: "Sort field. `trending` scores tokens by 24h change, volume, mcap, freshness, and trade recency. `lt-movers` sorts by the backing LT's own 24h % change (descending), tiebreaks on the token's own 24h change, and drops anything with a null or non-positive 24h change (on either the LT or the token) — so the list is always tokens actively gaining *because of* LT movement. Both scored sorts ignore `dir`, always return highest-score first, and are capped at the 500 most-recent tokens matching the filters." },
          { name: "dir", in: "query", schema: { type: "string", enum: ["asc", "desc"], default: "desc" }, description: "Sort direction" },
          apiKeyHeader,
        ],
        responses: {
          "200": {
            description: "List of tokens with on-chain enrichment (curve state, USD raised, USD-denominated graduation progress, organic-vs-leverage split). Same shape as `GET /api/v1/tokens/{address}`.",
            content: { "application/json": { schema: successResponse({ type: "array", items: { $ref: "#/components/schemas/TokenDetail" } }) } },
          },
          "400": { description: "Invalid pagination parameters", content: { "application/json": { schema: errorResponse } } },
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
        description: "Returns full token details including on-chain data from the indexer (curve supply, LT reserve, graduation progress).",
        parameters: [addressParam("address", "Token contract address"), apiKeyHeader],
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

    "/api/v1/tokens/{address}/comments": {
      get: {
        tags: ["Comments"],
        summary: "List token comments",
        description: "Returns paginated comments for a specific token.",
        parameters: [
          addressParam("address", "Token contract address"),
          ...paginationParams,
          apiKeyHeader,
        ],
        responses: {
          "200": {
            description: "List of comments",
            content: { "application/json": { schema: successResponse({ type: "array", items: { $ref: "#/components/schemas/Comment" } }) } },
          },
          "400": { description: "Invalid address or pagination", content: { "application/json": { schema: errorResponse } } },
        },
      },
      post: {
        tags: ["Comments"],
        summary: "Post a comment",
        description: "Post a comment on a token. Requires a session signature (see `buildSessionMessage`). Rate limited to 1 comment per 3s per wallet per token.",
        parameters: [addressParam("address", "Token contract address"), apiKeyHeader],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["author", "content", "signature", "expiresAt"],
                properties: {
                  author: { type: "string", description: "Author wallet address" },
                  content: { type: "string", minLength: 1, maxLength: 500 },
                  signature: { type: "string", description: "EIP-191 signature of the session message" },
                  expiresAt: { type: "number", description: "Session expiry timestamp in milliseconds since epoch" },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Comment created", content: { "application/json": { schema: successResponse({ $ref: "#/components/schemas/Comment" }) } } },
          "400": { description: "Validation error", content: { "application/json": { schema: errorResponse } } },
          "401": { description: "Invalid or expired signature", content: { "application/json": { schema: errorResponse } } },
          "429": { description: "Rate limit exceeded", content: { "application/json": { schema: errorResponse } } },
        },
      },
    },

    // ─── Trades ─────────────────────────────────────────────
    "/api/v1/trades": {
      get: {
        tags: ["Trades"],
        summary: "List recent trades",
        description: "Returns the most recent trades across all tokens.",
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 50 }, description: "Maximum number of trades" },
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
        description: "Returns all token positions for a wallet with cost basis. Computed from trade history.",
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
                          costBasisUsdc: { type: "string", description: "Total USDC spent (6 decimals)" },
                        },
                      },
                    },
                    approximate: { type: "boolean", description: "True if trade history was truncated (very active wallet)" },
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
        description: "Returns available underlying assets with spot prices and all supported BounceTech Leveraged Tokens. Cached for 10 seconds.",
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
                    creatorHoldingPct: { type: "number", description: "Creator's holding as percentage of total supply" },
                    contractVerified: { type: "boolean" },
                    graduated: { type: "boolean" },
                    poolAddress: { type: "string", nullable: true },
                    approximate: { type: "boolean", description: "True if trade history was truncated" },
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
    "/api/v1/referrals/{wallet}": {
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
