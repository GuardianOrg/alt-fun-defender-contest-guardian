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
   * Explicit override for the "Buy HYPE via Privy" button URL. When
   * set, used as-is and the MoonPay builder below is skipped. Privy
   * does not expose a public deeplink to its hosted funding page —
   * the SDK is the only supported entry point (see
   * https://docs.privy.io/wallets/funding/overview) — so this is the
   * escape hatch for any alternative onramp we want to point users
   * at (Transak, swapped.com, Hyperliquid deposit modal, etc.).
   */
  BUY_HYPE_URL?: string;
  /**
   * Publishable MoonPay key for the buy widget. When set together
   * with `MOONPAY_SECRET_KEY`, the bot builds a signed
   * `https://buy.moonpay.com/` URL with the user's custodial wallet
   * pre-filled — the documented direct-link path when Privy itself
   * has no public deeplink. Per MoonPay's URL signing spec, any URL
   * carrying `walletAddress` MUST also carry `currencyCode` and a
   * signature — both keys must be set or the bot falls back.
   */
  MOONPAY_API_KEY?: string;
  /**
   * Secret half of the MoonPay key pair, used to HMAC-SHA256 the
   * widget URL's query string. Never sent to the client — only used
   * server-side in `lib/moonpay.ts` to compute the `signature` param.
   */
  MOONPAY_SECRET_KEY?: string;
  /**
   * MoonPay currency code passed to the buy widget. Defaults to
   * `hype` when unset. Externalised because MoonPay occasionally
   * renames listings (e.g. chain-suffixed codes for the same asset)
   * and we want to rotate without a redeploy.
   */
  MOONPAY_CURRENCY_CODE?: string;
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
