export interface AppBindings {
  DATABASE_URL: string;
  BOUNCETECH_DATABASE_URL: string;
  ADMIN_API_KEY: string;
  /**
   * Comma-separated list of wallet addresses authorised to perform
   * wallet-signed moderation actions (e.g. hiding a token from the
   * public listings — see `routes/moderation.ts`). Whitespace around
   * each address is tolerated; case-insensitive. Leave unset to fall
   * back to `DEFAULT_ADMIN_WALLETS` from `@launchpad/shared` (which
   * ships with the canonical admin baked in so the feature works on a
   * fresh deploy without any extra configuration). See
   * `lib/admin-allowlist.ts` for the resolver.
   */
  ADMIN_WALLETS?: string;
  PONDER_URL: string;
  IMAGES_BUCKET: R2Bucket;
  WEBSOCKET_DO: DurableObjectNamespace;
  /**
   * Per-IP WebSocket connection-count tracker (`WsIpLimiter`). Lives at the
   * fixed name `"ws-ip-limiter"`. Queried by the `/ws` route to enforce
   * `MAX_CONNECTIONS_PER_IP` *before* the upgrade is accepted, since the
   * subject-sharded `WEBSOCKET_DO` shards no longer see all of an IP's
   * connections in one place. See `websocket/ip-limiter.ts`.
   */
  WS_IP_LIMITER_DO: DurableObjectNamespace;
  LT_TICKER_DO: DurableObjectNamespace;
  /**
   * Global `LtDirectoryPoller` instance (single shard, addressed via
   * `idFromName("lt-directory-poller")`). Owns the periodic refresh of
   * the `lt_directory` Postgres table by reading
   * `LeveragedTokenHelper.getLeveragedTokens()` on a 30s alarm cadence.
   * Touched once per Worker isolate (via `/ensure`) and once per cron
   * tick — both are idempotent. See
   * `apps/api/src/websocket/lt-directory-poller.ts`.
   *
   * No production consumer reads from the mirror yet; cutover from
   * the HTTP fan-out is deferred to a follow-up PR after parity is
   * verified end-to-end.
   */
  LT_DIRECTORY_POLLER_DO: DurableObjectNamespace;
  /**
   * OpenAI API key (`sk-...`) used by `lib/image-moderation.ts` to call the
   * `omni-moderation-latest` endpoint on every token-image upload. The
   * endpoint is free per OpenAI's pricing page, but a key is still required
   * for auth + per-org abuse tracking.
   *
   * Setup:
   *   1. Create a key at `https://platform.openai.com/api-keys` and apply
   *      least-privilege permissions per your org's key-restriction model
   *      — endpoint-based restrictions (Write on `/v1/moderations`) for
   *      restricted keys, or the equivalent RBAC role if the project uses
   *      RBAC. There is no dedicated "moderation" scope name.
   *   2. `wrangler secret put OPENAI_API_KEY` for prod / preview.
   *   3. Set in `.dev.vars` for local development.
   *
   * Optional in dev: leaving this blank causes every upload to 503 with
   * "moderation temporarily unavailable" — fail-closed by design (see the
   * file-level note in `image-moderation.ts`).
   */
  OPENAI_API_KEY?: string;
  /**
   * Hot-wallet private key (`0x…`-prefixed) for the graduation keeper. The
   * worker calls `Bonding.finalizeGraduation` from this account once a token
   * enters phase 1. Required setup:
   *   1. Generate a fresh wallet — never reuse the deployer key.
   *   2. Fund it with ~5 HYPE for gas (each finalize is ~2.5M big-block gas).
   *   3. Toggle big blocks ON for the keeper wallet:
   *        DEPLOYER_PRIVATE_KEY=<keeper key> node packages/contracts/scripts/toggle-big-blocks.mjs on
   *      The setting is sticky on Hyperliquid L1 — done once per wallet.
   *   4. `wrangler secret put KEEPER_PRIVATE_KEY` (prod) / set in `.dev.vars` (local).
   * Optional in dev: leaving this blank disables the keeper and logs a warn
   * on every cron tick.
   */
  KEEPER_PRIVATE_KEY?: string;
  /**
   * RPC URL the keeper uses to broadcast `finalizeGraduation`. Falls back
   * to the public HyperEVM RPC if unset. Shared with the auto-graduation
   * buyer keeper.
   */
  HYPEREVM_RPC_URL?: string;
  /**
   * Hot-wallet private key (`0x…`-prefixed) for the auto-graduation buyer.
   * Drives phase 1 of graduation for tokens that have crossed the USD
   * threshold purely from LT price appreciation (i.e. `Bonding.canGraduate`
   * returns true but no user buy has landed since the LT rallied). The
   * worker fires the smallest possible `Zap.buy` to trigger phase 1, then
   * unwinds the resulting token holding back to USDC via `Zap.sell` once
   * phase 2 finalises. Required setup:
   *   1. Generate a fresh wallet — never reuse `KEEPER_PRIVATE_KEY` or the
   *      deployer key. The two keepers MUST be different wallets because
   *      they target different block sizes.
   *   2. Fund with HYPE for gas (each cycle is two ~120k-gas txs).
   *   3. Fund with USDC — sized to ~$120 of in-flight capital plus a
   *      cushion (max 5 buys × $20 trigger amount per tick, with
   *      headroom for positions awaiting phase 2 finalize).
   *   4. **Leave big blocks OFF** (default). The finalize keeper toggles
   *      its wallet ON for ~2.5M-gas finalize calls; this keeper must
   *      stay on small blocks so its sub-second buys/sells aren't queued
   *      behind ~60s big-block confirmations. If the wallet was ever
   *      toggled, run
   *        DEPLOYER_PRIVATE_KEY=<this key> node packages/contracts/scripts/toggle-big-blocks.mjs off
   *      to flip back before deploying the secret.
   *   5. `wrangler secret put AUTO_GRADUATION_BUYER_PRIVATE_KEY` for prod
   *      / preview. Set in `.dev.vars` for local development.
   * Optional in dev: leaving this blank disables the keeper and logs a
   * warn on every cron tick.
   */
  AUTO_GRADUATION_BUYER_PRIVATE_KEY?: string;
  /**
   * Shared KV namespace with `apps/telegram-bot` (binding `WALLET_KV`,
   * namespace `launchpad-telegram`). The api only touches the
   * `rewards-wallet:<addr>` keyspace owned by the bot's `/referral`
   * surface — see `routes/bot/referrals.ts`. All wallet records and
   * session state live under disjoint key prefixes managed by the bot
   * worker. Optional in the type so existing route handlers / test
   * envs don't need to thread a stub; the bot-referrals route checks
   * for presence and surfaces a clean 503 when the binding is missing.
   */
  WALLET_KV?: KVNamespace;
}
