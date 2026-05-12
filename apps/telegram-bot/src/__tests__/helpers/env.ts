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
    delete: async () => undefined,
  }) as unknown as KVNamespace;

/**
 * Stub Durable Object namespace for tests. The actual DO never runs in
 * unit tests — tests bypass the webhook → DO routing and invoke
 * `bot.handleUpdate` directly via `createBot(env)`. The stub exists so
 * `Env` is fully typed and code paths that incidentally touch the
 * binding don't crash.
 */
const stubChatDO = (): DurableObjectNamespace =>
  ({
    idFromName: () => ({}) as DurableObjectId,
    get: () =>
      ({
        fetch: async () => new Response("ok"),
      }) as unknown as DurableObjectStub,
  }) as unknown as DurableObjectNamespace;

export const makeTestEnv = (overrides: Partial<Env> = {}): Env => ({
  TELEGRAM_BOT_TOKEN: "test-bot-token",
  TELEGRAM_WEBHOOK_SECRET: "test-secret",
  ADMIN_API_KEY: "test-admin-key",
  API_BASE_URL: "https://api.test.local",
  API_KEY: "test-api-key",
  MASTER_KEY: ZERO_MASTER_KEY,
  WALLET_KV: stubKV(),
  CHAT_DO: stubChatDO(),
  ...overrides,
});
