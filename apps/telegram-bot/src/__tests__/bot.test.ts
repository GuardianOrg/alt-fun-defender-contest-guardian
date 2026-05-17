import { describe, it, expect } from "vitest";

import { createBot } from "../bot.js";
import { makeTestEnv } from "./helpers/env.js";

/**
 * Boot-time contract: the bot must refuse to construct without an
 * `X-API-Key` secret. The bot fans every user through one Cloudflare
 * Worker egress IP, so a missing key would bucket the entire fleet into
 * apps/api's anonymous 240/min per-IP rate limit and self-starve within
 * a handful of concurrent commands. AGENTS.md "Auth model" is the
 * binding contract; this test pins it so a future refactor cannot
 * silently restore the degraded path.
 */
describe("createBot — API_KEY guard", () => {
  it("throws when API_KEY is unset", () => {
    const env = makeTestEnv({ API_KEY: undefined as unknown as string });
    expect(() => createBot(env)).toThrow(/API_KEY/);
  });

  it("throws when API_KEY is the empty string", () => {
    const env = makeTestEnv({ API_KEY: "" });
    expect(() => createBot(env)).toThrow(/API_KEY/);
  });

  it("throws when API_KEY is whitespace-only", () => {
    const env = makeTestEnv({ API_KEY: "   " });
    expect(() => createBot(env)).toThrow(/API_KEY/);
  });

  it("constructs when API_KEY is set", () => {
    const env = makeTestEnv({ API_KEY: "test-api-key" });
    expect(() => createBot(env)).not.toThrow();
  });
});
