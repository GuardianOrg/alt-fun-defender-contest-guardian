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
   * Dedicated `X-API-Key` for the bot's calls into `apps/api`. Anonymous
   * (no key) buckets every user behind a single Worker IP under the
   * 240/min ceiling — see AGENTS.md "Auth model".
   */
  API_KEY: string;
  /**
   * AES-256-GCM master key for custodial wallets — 32 raw bytes,
   * base64-encoded. Rotating it invalidates every stored wallet because
   * the per-user derived key changes; there is no re-encryption migration
   * in v1. See apps/telegram-bot/AGENTS.md for the threat model.
   */
  MASTER_KEY: string;
  WALLET_KV: KVNamespace;
}

export type AppBindings = { Bindings: Env };
