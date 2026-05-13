import { describe, it, expect } from "vitest";

import wrangler from "../../wrangler.json" with { type: "json" };

describe("wrangler.json", () => {
  it("defines a non-empty BOT_USERNAME var so referral links resolve to the deployed bot", () => {
    const config = wrangler as { vars?: Record<string, unknown> };
    expect(config.vars).toBeDefined();
    const botUsername = config.vars?.BOT_USERNAME;
    expect(typeof botUsername).toBe("string");
    expect((botUsername as string).trim().length).toBeGreaterThan(0);
    expect(botUsername).toMatch(/^[A-Za-z0-9_]{5,32}$/);
  });
});
