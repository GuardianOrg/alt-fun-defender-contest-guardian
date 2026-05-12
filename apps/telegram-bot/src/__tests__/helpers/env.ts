import type { Env } from "../../lib/types.js";

/**
 * 32-byte all-zero MASTER_KEY, base64-encoded. Suitable for tests that
 * never decrypt real ciphertext; tests that do should pass their own
 * key so a flipped byte produces a verifiable decrypt failure.
 */
const ZERO_MASTER_KEY = btoa("\0".repeat(32));

const stubKV = (): KVNamespace =>
  ({
    get: async () => null,
    put: async () => undefined,
  }) as unknown as KVNamespace;

export const makeTestEnv = (overrides: Partial<Env> = {}): Env => ({
  TELEGRAM_BOT_TOKEN: "test-bot-token",
  TELEGRAM_WEBHOOK_SECRET: "test-secret",
  ADMIN_API_KEY: "test-admin-key",
  MASTER_KEY: ZERO_MASTER_KEY,
  WALLET_KV: stubKV(),
  ...overrides,
});
