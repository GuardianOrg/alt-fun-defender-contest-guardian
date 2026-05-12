export interface Env {
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  ADMIN_API_KEY: string;
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
