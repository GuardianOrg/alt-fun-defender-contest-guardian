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
   * Optional override for the PBKDF2 iteration count used by
   * `lib/pin.ts`. Production leaves this unset and falls back to the
   * OWASP-grade default (600k). Tests inject a small value (~1k) so
   * the multi-PIN conversation suite finishes in single-digit
   * milliseconds per derive instead of the half-second prod cost.
   */
  PIN_ITERATIONS?: number;
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
