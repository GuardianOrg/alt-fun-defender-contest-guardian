import { pgTable, text, timestamp, boolean, integer, numeric, varchar } from "drizzle-orm/pg-core";

export const tokens = pgTable("tokens", {
  address: varchar("address", { length: 42 }).primaryKey(),
  name: text("name").notNull(),
  ticker: varchar("ticker", { length: 8 }).notNull(),
  description: text("description").notNull().default(""),
  imageUrl: text("image_url").notNull().default(""),
  ltPair: varchar("lt_pair", { length: 42 }).notNull(),
  ltDirection: varchar("lt_direction", { length: 5 }).notNull(),
  leverage: integer("leverage").notNull(),
  underlying: varchar("underlying", { length: 10 }).notNull().default("HYPE"),
  status: varchar("status", { length: 20 }).notNull().default("curve"),
  graduatedAt: timestamp("graduated_at"),
  poolAddress: varchar("pool_address", { length: 42 }),
  creator: varchar("creator", { length: 42 }).notNull(),
  isHidden: boolean("is_hidden").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const comments = pgTable("comments", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  tokenAddress: varchar("token_address", { length: 42 })
    .notNull()
    .references(() => tokens.address),
  author: varchar("author", { length: 42 }).notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const apiKeys = pgTable("api_keys", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  key: varchar("key", { length: 64 }).notNull().unique(),
  name: text("name").notNull(),
  ownerAddress: varchar("owner_address", { length: 42 }).notNull(),
  rateLimit: integer("rate_limit").notNull().default(100),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const userProfiles = pgTable("user_profiles", {
  address: varchar("address", { length: 42 }).primaryKey(),
  displayName: text("display_name"),
  bio: text("bio"),
  twitterUrl: text("twitter_url"),
  totalVolume: numeric("total_volume").notNull().default("0"),
  totalTrades: integer("total_trades").notNull().default(0),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
