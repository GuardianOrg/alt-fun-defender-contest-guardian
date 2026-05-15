import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, boolean, integer, numeric, varchar, index } from "drizzle-orm/pg-core";

export const tokens = pgTable(
  "tokens",
  {
    address: varchar("address", { length: 42 }).primaryKey(),
    name: text("name").notNull(),
    ticker: varchar("ticker", { length: 10 }).notNull(),
    description: text("description").notNull().default(""),
    imageUrl: text("image_url").notNull().default(""),
    ltPair: varchar("lt_pair", { length: 42 }).notNull(),
    ltDirection: varchar("lt_direction", { length: 5 }).notNull(),
    leverage: integer("leverage").notNull(),
    // Width sized for `xyz:BRENTOIL` (12 chars) plus headroom for new
    // BounceTech LT additions. The on-chain `targetAsset` keeps its full
    // namespaced symbol (e.g. `xyz:SP500`) so this column round-trips it
    // verbatim — display surfaces strip the `xyz:` prefix at render time.
    underlying: varchar("underlying", { length: 24 }).notNull().default("HYPE"),
    status: varchar("status", { length: 20 }).notNull().default("curve"),
    graduatedAt: timestamp("graduated_at"),
    poolAddress: varchar("pool_address", { length: 42 }),
    twitterUrl: text("twitter_url").notNull().default(""),
    telegramUrl: text("telegram_url").notNull().default(""),
    websiteUrl: text("website_url").notNull().default(""),
    creator: varchar("creator", { length: 42 }).notNull(),
    isHidden: boolean("is_hidden").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  // Indexes were added after the system started seeing thundering-herd
  // /tokens traffic on shared-IP networks (issue: 5.4M sequential scans
  // observed on this 614-row table in pg_stat_user_tables since last
  // reset). At today's row count the seq scans run in <1ms so the
  // indexes are mostly future-proofing — but the partial index on
  // `(is_hidden=false, created_at DESC)` matches the default-sort path
  // exactly and pays back today on cold cache misses. Mirror in DB via
  // the Neon `prepare_database_migration` flow (see
  // `.cursor/rules/migrations.mdc`); this declaration is the typed view.
  (table) => [
    index("tokens_visible_created_at_idx")
      .on(table.createdAt.desc())
      .where(sql`${table.isHidden} = false`),
    index("tokens_creator_idx").on(table.creator),
    index("tokens_underlying_idx").on(table.underlying),
    index("tokens_lt_pair_idx").on(table.ltPair),
    index("tokens_status_idx").on(table.status),
    // Trigram GIN indexes back the `/search` ILIKE `%q%` queries; without
    // them every keystroke seq-scans the table. Requires `pg_trgm`.
    index("tokens_name_trgm_idx").using("gin", sql`${table.name} gin_trgm_ops`),
    index("tokens_ticker_trgm_idx").using(
      "gin",
      sql`${table.ticker} gin_trgm_ops`,
    ),
  ],
);

export const apiKeys = pgTable("api_keys", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  keyHash: varchar("key_hash", { length: 64 }).notNull().unique(),
  keyPrefix: varchar("key_prefix", { length: 8 }).notNull(),
  name: text("name").notNull(),
  ownerAddress: varchar("owner_address", { length: 42 }).notNull(),
  rateLimit: integer("rate_limit").notNull().default(100),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("api_keys_key_prefix_idx").on(table.keyPrefix),
]);

export const moderationLogs = pgTable("moderation_logs", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  imageKey: text("image_key").notNull(),
  decision: varchar("decision", { length: 20 }).notNull(), // "approved" | "rejected" | "pending_review"
  reason: text("reason").notNull().default(""),
  classifications: text("classifications").notNull().default("[]"), // JSON array of {label, score}
  reviewedBy: varchar("reviewed_by", { length: 42 }),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("moderation_logs_decision_idx").on(table.decision),
]);

/**
 * BounceTech leveraged-token directory mirror. Populated by the
 * `LtDirectoryPoller` Durable Object on a 30s alarm cadence (see
 * `apps/api/src/websocket/lt-directory-poller.ts`). The poller reads
 * `LeveragedTokenHelper.getLeveragedTokens()` over RPC for the
 * dynamic fields (`exchangeRate`, `mintPaused`, `baseAssetBalance`,
 * `totalAssets`) and falls back to a one-shot `name`/`symbol`/`decimals`
 * ERC-20 multicall for newly-discovered LT addresses.
 *
 * NOTE: This is the *additive* landing of the mirror. No existing
 * consumer reads from this table yet — the cutover from
 * `${BOUNCE_INDEXING_API}/leveraged-tokens` to the mirror lives in a
 * separate change behind a parity-verification follow-up.
 *
 * `address` is stored checksummed (matching every other address column
 * in this file). `targetAsset` keeps the on-chain namespacing
 * (e.g. `xyz:NVDA`) so client surfaces can strip the prefix at render
 * time without touching the source row.
 *
 * `lastSeenAt` is bumped on every successful poll that includes this LT.
 * `pollSequence` is a monotonically-increasing counter (bumped per
 * successful poll, *shared* across rows in that poll).
 */
export const ltDirectory = pgTable("lt_directory", {
  address: varchar("address", { length: 42 }).primaryKey(),
  symbol: text("symbol").notNull(),
  name: text("name").notNull(),
  targetAsset: text("target_asset").notNull(),
  targetLeverage: integer("target_leverage").notNull(),
  isLong: boolean("is_long").notNull(),
  decimals: integer("decimals").notNull().default(18),
  // `numeric(78,0)` holds the full 2^256 range that BounceTech's
  // `uint256 exchangeRate` could in principle return. Drizzle's
  // `numeric` maps to Postgres' arbitrary-precision NUMERIC, so we
  // round-trip the value as a decimal string and let consumers parse.
  exchangeRate: numeric("exchange_rate", { precision: 78, scale: 0 })
    .notNull()
    .default("0"),
  mintPaused: boolean("mint_paused").notNull().default(false),
  baseAssetBalance: numeric("base_asset_balance", { precision: 78, scale: 0 })
    .notNull()
    .default("0"),
  totalAssets: numeric("total_assets", { precision: 78, scale: 0 })
    .notNull()
    .default("0"),
  pollSequence: integer("poll_sequence").notNull().default(0),
  lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("lt_directory_last_seen_at_idx").on(table.lastSeenAt),
]);

export const userProfiles = pgTable("user_profiles", {
  address: varchar("address", { length: 42 }).primaryKey(),
  displayName: text("display_name"),
  bio: text("bio"),
  twitterUrl: text("twitter_url"),
  totalVolume: numeric("total_volume").notNull().default("0"),
  totalTrades: integer("total_trades").notNull().default(0),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
