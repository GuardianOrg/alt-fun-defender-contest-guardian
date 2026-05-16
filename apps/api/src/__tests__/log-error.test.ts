import { describe, it, expect } from "vitest";

import { describeError, sanitizeErrorSidecar } from "../lib/log-error.js";

// Unit tests for the shared error-shaping helper. The integration tests
// in `indexer-reads-error-logging.test.ts` and `ponder-client.test.ts`
// cover the call-site wiring (drives `console.log` through the actual
// log shim); these tests pin the helper's contract directly so a future
// refactor that re-shapes the JSON payload trips here first. Issue #974.

describe("describeError", () => {
  it("returns the structured shape for a vanilla Error", () => {
    const result = describeError(new Error("boom")) as Record<string, unknown>;
    expect(result.name).toBe("Error");
    expect(result.message).toBe("boom");
    // Untouched optional fields stay `undefined` and drop out of the
    // serialised log line via `JSON.stringify`'s standard behaviour.
    expect(result.code).toBeUndefined();
    expect(result.cause).toBeUndefined();
    expect(result.sourceError).toBeUndefined();
  });

  it("unwraps a nested Error cause with a truncated stack", () => {
    const cause = new Error("inner");
    cause.stack = Array.from({ length: 12 }, (_, i) => `at line${i}`).join("\n");
    const error = Object.assign(new Error("outer"), { cause });

    const result = describeError(error) as Record<string, unknown>;
    const causeShape = result.cause as Record<string, unknown>;
    expect(causeShape.name).toBe("Error");
    expect(causeShape.message).toBe("inner");
    // Five lines is enough to identify the originating frame inside
    // the Neon HTTP / fetch shim without bloating the log line.
    expect((causeShape.stack as string).split("\n")).toHaveLength(5);
  });

  it("surfaces non-Error causes (plain object payloads) verbatim", () => {
    const error = Object.assign(new Error("Failed query"), {
      cause: { status: 502, body: "Bad Gateway" },
    });
    const result = describeError(error) as Record<string, unknown>;
    expect(result.cause).toEqual({ status: 502, body: "Bad Gateway" });
  });

  it("redacts credential-shaped keys at every nesting level", () => {
    // Defence-in-depth: if a future driver upgrade attaches sensitive
    // fields (`Authorization`, `cookie`, `connectionString`) to a
    // sidecar, they must never make it into Cloudflare logs verbatim.
    const error = Object.assign(new Error("boom"), {
      cause: {
        status: 503,
        headers: {
          authorization: "Bearer LEAKED",
          "x-trace-id": "kept",
        },
        databaseUrl: "postgres://user:S3CRET@neon.tech",
        nestedList: [{ token: "ALSO-LEAKED", info: "kept" }],
      },
    });

    const result = describeError(error) as Record<string, unknown>;
    const cause = result.cause as Record<string, unknown>;
    expect(cause.status).toBe(503);
    expect(cause.databaseUrl).toBe("[REDACTED]");
    const headers = cause.headers as Record<string, unknown>;
    expect(headers.authorization).toBe("[REDACTED]");
    expect(headers["x-trace-id"]).toBe("kept");
    const nested = (cause.nestedList as Array<Record<string, unknown>>)[0];
    expect(nested.token).toBe("[REDACTED]");
    expect(nested.info).toBe("kept");

    // And the serialised line itself should carry no leak.
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain("LEAKED");
    expect(serialised).not.toContain("S3CRET");
  });

  it("falls back to String(...) on a circular sidecar so the log line stays valid", () => {
    const circular: Record<string, unknown> = { status: 500 };
    circular.self = circular;
    const error = Object.assign(new Error("boom"), { cause: circular });
    const result = describeError(error) as Record<string, unknown>;
    // Cause survives as a string fallback; no throw, no dropped log.
    expect(typeof result.cause).toBe("string");
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it("safe-serializes a non-primitive `code` so the outer JSON.stringify never throws", () => {
    const circularCode: Record<string, unknown> = { value: "ETIMEDOUT" };
    circularCode.self = circularCode;
    const error = Object.assign(new Error("boom"), { code: circularCode });
    const result = describeError(error) as Record<string, unknown>;
    expect(result.code).toBeDefined();
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it("passes string and number `code` through unchanged", () => {
    expect(
      (describeError(Object.assign(new Error("e"), { code: "ETIMEDOUT" })) as Record<string, unknown>).code,
    ).toBe("ETIMEDOUT");
    expect(
      (describeError(Object.assign(new Error("e"), { code: 42 })) as Record<string, unknown>).code,
    ).toBe(42);
  });

  it("applies the optional message transform without touching other fields", () => {
    // Drizzle's `Failed query: <SQL>\nparams: <values>` wrapper is
    // stripped to its first line at the call site in `indexer-reads.ts`.
    // The transform must not affect the cause / code / sourceError
    // fields, only the top-level `message`.
    const error = Object.assign(
      new Error("Failed query: \n      SELECT 1\nparams: "),
      { cause: new Error("Multi\nline\ncause"), code: "X" },
    );
    const result = describeError(error, (m) => m.split("\n", 1)[0]) as Record<
      string,
      unknown
    >;
    expect(result.message).toBe("Failed query: ");
    // Cause messages keep their original newlines — only the wrapper
    // gets the bloat strip.
    expect((result.cause as Record<string, unknown>).message).toBe(
      "Multi\nline\ncause",
    );
    expect(result.code).toBe("X");
  });

  it("returns String(value) for non-Error throws and `undefined` for `undefined`", () => {
    expect(describeError("kaboom")).toBe("kaboom");
    expect(describeError(42)).toBe("42");
    // `undefined` falls out of the log line via JSON.stringify's
    // standard behaviour — no `error: "undefined"` literal noise.
    expect(describeError(undefined)).toBeUndefined();
  });
});

describe("sanitizeErrorSidecar", () => {
  it("returns primitives unchanged", () => {
    expect(sanitizeErrorSidecar("ok")).toBe("ok");
    expect(sanitizeErrorSidecar(0)).toBe(0);
    expect(sanitizeErrorSidecar(true)).toBe(true);
    expect(sanitizeErrorSidecar(null)).toBeNull();
    expect(sanitizeErrorSidecar(undefined)).toBeUndefined();
  });

  it("strips functions and prototype noise via JSON round-trip", () => {
    const value = Object.assign(Object.create({ inherited: 1 }), {
      kept: "ok",
      fn: () => undefined,
    });
    const result = sanitizeErrorSidecar(value) as Record<string, unknown>;
    expect(result.kept).toBe("ok");
    expect(result.fn).toBeUndefined();
    expect(result.inherited).toBeUndefined();
  });
});
