export interface AppBindings {
  DATABASE_URL: string;
  BOUNCETECH_DATABASE_URL: string;
  ADMIN_API_KEY: string;
  PONDER_URL: string;
  IMAGES_BUCKET: R2Bucket;
  WEBSOCKET_DO: DurableObjectNamespace;
  LT_TICKER_DO: DurableObjectNamespace;
  AI: Ai;
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
   * to the public HyperEVM RPC if unset.
   */
  HYPEREVM_RPC_URL?: string;
  /**
   * Public-facing origin of this API Worker (e.g. `https://api.alt.fun`).
   * Used by the cron registration backfill to canonicalize image URLs read
   * from on-chain `TokenInfo` — ensures the stored `imageUrl` always points
   * at our own domain, even when a token was launched directly via the
   * contract with a foreign host in the `image` field.
   *
   * Set via `wrangler secret put IMAGES_PUBLIC_URL` (prod) or `.dev.vars`
   * (local). When unset, the cron falls back to storing the validated raw
   * URL (still verified to be a key in our R2 bucket, just not guaranteed
   * to be on our domain).
   */
  IMAGES_PUBLIC_URL?: string;
}
