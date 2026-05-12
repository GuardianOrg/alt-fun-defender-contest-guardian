import { vi } from "vitest";
import type { Update } from "grammy/types";

import { createBot } from "../../bot.js";
import { makeTestEnv } from "./env.js";

/**
 * Default Telegram API responses follow `{ ok: true, result: ... }`.
 * Returning a bare `{}` makes grammY think every call failed and bubble
 * a BotError up through `handleUpdate`, which masks the actual assertion
 * a test is trying to make. Helpers below wrap a fetch mock so the
 * Telegram-side calls always look successful while api.test.local calls
 * still pass through to test-provided mock implementations.
 */
const TELEGRAM_API_HOST = "https://api.telegram.org";

const okResponse = (result: unknown = true): Response =>
  new Response(JSON.stringify({ ok: true, result }), { status: 200 });

export const mockTelegramOk = (
  fetchSpy: ReturnType<typeof vi.spyOn>,
): void => {
  fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
    if (String(input).startsWith(TELEGRAM_API_HOST)) {
      return okResponse(true);
    }
    // Fail fast on any other URL — silently returning 200 `{}` would
    // hide unmocked upstream calls (e.g. apps/api reads from inside a
    // wallet handler) and weaken every test that uses this helper.
    // Tests that need other URLs should compose their own mock via
    // `withTelegramOk` or a bespoke `mockImplementation`.
    throw new Error(
      `Unexpected fetch in test (no mock registered): ${String(input)}`,
    );
  });
};

/**
 * Wrap a test-provided mock with a Telegram-API fallback so user code
 * only has to describe the upstream calls (api.test.local) it cares
 * about.
 */
export const withTelegramOk = (
  fetchSpy: ReturnType<typeof vi.spyOn>,
  inner: (input: RequestInfo | URL) => Promise<Response>,
): void => {
  fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
    if (String(input).startsWith(TELEGRAM_API_HOST)) {
      return okResponse(true);
    }
    return inner(input);
  });
};

/**
 * In-memory KV that survives across helpers — same instance per test.
 * Backs the grammY session storage so reads/writes within a single
 * test see each other.
 */
export class MemoryKV {
  private readonly store = new Map<string, string>();
  failPut = false;
  failDelete = false;

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    if (this.failPut) throw new Error("kv put failed");
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    if (this.failDelete) throw new Error("kv delete failed");
    this.store.delete(key);
  }

  size(): number {
    return this.store.size;
  }
}

const ZERO_MASTER_KEY = btoa("\0".repeat(32));

export interface BotTestHarness {
  env: ReturnType<typeof makeTestEnv>;
  kv: MemoryKV;
  run: (update: object) => Promise<void>;
}

/**
 * Build a self-contained bot harness for one test. Bypasses the
 * webhook → DO routing layer; we test the bot's `handleUpdate`
 * directly with an in-memory KV behind grammY's session middleware
 * and the wallet manager. The webhook → DO path is exercised
 * separately by `webhook.test.ts`.
 */
export const makeBotHarness = (): BotTestHarness => {
  const kv = new MemoryKV();
  const env = makeTestEnv({
    MASTER_KEY: ZERO_MASTER_KEY,
    WALLET_KV: kv as unknown as KVNamespace,
  });
  return {
    env,
    kv,
    run: async (update: object): Promise<void> => {
      // Pass `globalThis.fetch` (post-spy) so grammY's Telegram API
      // calls go through the test's `vi.spyOn` instead of grammY's
      // Node shim (which routes via `node-fetch` and bypasses the spy).
      const bot = createBot(env, { fetch: globalThis.fetch });
      await bot.handleUpdate(update as Update);
    },
  };
};
