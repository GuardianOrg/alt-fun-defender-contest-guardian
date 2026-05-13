export interface Env {
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  ADMIN_API_KEY: string;
  /**
   * Base URL of `apps/api`. Reads only — see apps/telegram-bot/AGENTS.md
   * "API surface consumed from apps/api". No trailing slash.
   */
  API_BASE_URL: string;
  /**
   * Dedicated `X-API-Key` for the bot's calls into `apps/api`. Optional
   * to allow smoke-test deploys before the apps/api `api_keys` row is
   * provisioned — when undefined, `lib/api.ts` omits the header and
   * requests fall into apps/api's anonymous per-IP rate limit (240/min,
   * shared across every user on the bot Worker). Provisioning tracked in
   * #640; AGENTS.md "Auth model" still describes the eventual contract.
   */
  API_KEY?: string;
  /**
   * AES-256-GCM master key for custodial wallets — 32 raw bytes,
   * base64-encoded. Rotating it invalidates every stored wallet because
   * the per-user derived key changes; there is no re-encryption migration
   * in v1. See apps/telegram-bot/AGENTS.md for the threat model.
   */
  MASTER_KEY: string;
  /**
   * HyperEVM RPC endpoint. Used by `lib/rpc.ts` for read-only balance
   * lookups on `/start` and refresh. Optional — falls back to the
   * public HyperEVM RPC (`https://rpc.hyperliquid.xyz/evm`) when unset
   * so smoke deploys keep working without Alchemy provisioning. Match
   * apps/api's `HYPEREVM_RPC_URL` secret in production.
   */
  HYPEREVM_RPC_URL?: string;
  /**
   * BotFeeRouter deployed contract address (issue #686). The bot routes
   * every `/buy` and `/sell` through this contract so the operator fee is
   * skimmed and the referrer split settles on-chain — see
   * apps/telegram-bot/AGENTS.md "Bot Fee Model". Optional in v1 because
   * the router hasn't been deployed yet; when unset, `lib/trade.ts`
   * skips the on-chain simulation and the sell flow falls back to the
   * legacy priceUsd × balance estimate. Rotation = deploy a new router
   * and push the new address; the constructor-set parameters
   * (`botFeeBps`, `referrerShareBps`, `treasury`) cannot be changed
   * on a deployed router.
   */
  BOT_FEE_ROUTER_ADDRESS?: string;
  /**
   * Explicit override for the "Buy USDC via Relay" button URL. When
   * set, used as-is and the Relay onramp builder below is skipped.
   * Privy's hosted funding page is SDK-only (see
   * https://docs.privy.io/wallets/funding/overview) and MoonPay has
   * no HyperEVM USDC listing, so Relay is the only path that
   * delivers USDC directly onto HyperEVM today; this override is
   * the escape hatch for campaign-tracked variants or alternative
   * onramps.
   */
  BUY_USDC_URL?: string;
  /**
   * Telegram username of the bot (without `@`). Used to build the
   * shareable referral deeplink `t.me/<BOT_USERNAME>?start=ref_<userId>`
   * surfaced by `/referral`. Optional — falls back to a placeholder
   * when unset so smoke deploys keep rendering a link. Set the real
   * BotFather handle in production.
   */
  BOT_USERNAME?: string;
  /**
   * Optional override for the bcrypt cost factor used by
   * `lib/pin.ts`. Production leaves this unset and falls back to the
   * OWASP-recommended default (rounds=12, ~250ms per hash on
   * Workers). Tests inject the bcrypt minimum (rounds=4, <5ms) so
   * the multi-PIN conversation suite stays under a second.
   */
  PIN_SALT_ROUNDS?: number;
  WALLET_KV: KVNamespace;
  /**
   * Durable Object namespace binding. One DO instance per Telegram chat
   * — webhook routing computes `idFromName(\`chat:${chatId}\`)` and the
   * DO serialises updates on its single-threaded event loop. See
   * `chat-do.ts` for the rationale (closes the WAR hazard grammY's
   * docs warn about for serverless `session` + `conversations`).
   */
  CHAT_DO: DurableObjectNamespace;
}

export type AppBindings = { Bindings: Env };
