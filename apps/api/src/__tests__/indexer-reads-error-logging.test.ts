import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// `logIndexerReadFailure` is module-private but every read in the module
// runs it on `catch`. Driving the assertions through `fetchTokenLabels`
// (the simplest catch path — pure Drizzle builder, no `db.execute(sql)`
// raw-SQL detour, no tuple-result unpack) keeps the test focused on the
// log shape rather than the read it sits behind. Mirrors the pattern in
// `indexer-reads-chart-snapshots.test.ts`.
const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});

// Each `db.select(...)` call returns a fresh chain that throws on `await`
// so the catch in `fetchTokenLabels` runs and `logIndexerReadFailure`
// fires. The thrown value is set per-test via `nextThrowable`.
let nextThrowable: unknown = new Error("default");

vi.mock("../db/client.js", () => ({
  createDb: () => ({
    select: () => {
      const chain: Record<string, unknown> = {};
      chain.from = () => chain;
      chain.where = () => chain;
      chain.then = (
        _resolve: (v: unknown) => void,
        reject: (e: unknown) => void,
      ) => reject(nextThrowable);
      return chain;
    },
  }),
}));

const { createDb } = await import("../db/client.js");
const { fetchTokenLabels } = await import("../lib/indexer-reads.js");

function captureLog(): Record<string, unknown> {
  // Last call wins — `fetchTokenLabels` fires the log exactly once per
  // failure, and we reset the spy between tests.
  expect(consoleLogSpy).toHaveBeenCalledTimes(1);
  const [raw] = consoleLogSpy.mock.calls[0] as [string];
  return JSON.parse(raw) as Record<string, unknown>;
}

describe("logIndexerReadFailure — error.cause unwrapping", () => {
  beforeEach(() => {
    consoleLogSpy.mockClear();
  });

  afterEach(() => {
    nextThrowable = new Error("default");
  });

  it("includes a structured `cause` when the thrown error carries one", async () => {
    // Mirrors the real production failure mode the issue describes:
    // Drizzle wraps the underlying Neon HTTP failure with
    // `Failed query: <SQL>\nparams: <values>` and stashes the actual
    // status / response body in `error.cause`. Without unwrapping, every
    // 5xx / timeout / AbortSignal looks identical in Cloudflare logs
    // and the `_failed` clusters are unactionable. Issue #974.
    const cause = new Error("HTTP 503: Neon proxy timeout");
    cause.name = "NeonDbError";
    nextThrowable = Object.assign(
      new Error("Failed query: \n      SELECT 1\nparams: "),
      { cause, code: "ETIMEDOUT" },
    );

    const result = await fetchTokenLabels(
      createDb("postgres://test"),
      ["0xabc"],
    );

    expect(result).toBeNull();

    const log = captureLog();
    expect(log.level).toBe("error");
    expect(log.event).toBe("indexer_reads.fetchTokenLabels_failed");
    expect(log.addressCount).toBe(1);

    const errorPayload = log.error as Record<string, unknown>;
    // The wrapper message gets the SQL+params bloat stripped — first
    // line only — so the log line stays grep-able.
    expect(errorPayload.name).toBe("Error");
    expect(errorPayload.message).toBe("Failed query: ");
    expect(errorPayload.message).not.toContain("SELECT");
    expect(errorPayload.code).toBe("ETIMEDOUT");

    const causeShape = errorPayload.cause as Record<string, unknown>;
    expect(causeShape.name).toBe("NeonDbError");
    expect(causeShape.message).toBe("HTTP 503: Neon proxy timeout");
    // Stack is truncated to ≤5 lines so the log line stays bounded
    // even when the cause originates deep in the Neon HTTP driver.
    expect(typeof causeShape.stack).toBe("string");
    expect((causeShape.stack as string).split("\n").length).toBeLessThanOrEqual(
      5,
    );
  });

  it("surfaces a non-Error `cause` (object payload from neon-http) verbatim", async () => {
    // Some neon-http failure modes attach a plain object payload as the
    // cause rather than a nested `Error`. The unwrap path must keep
    // those visible — `JSON.stringify` on a plain object stays valid
    // and surfaces `status` / `body` for triage.
    nextThrowable = Object.assign(new Error("Failed query: ..."), {
      cause: { status: 500, body: "internal server error" },
    });

    await fetchTokenLabels(createDb("postgres://test"), ["0xabc"]);

    const errorPayload = captureLog().error as Record<string, unknown>;
    expect(errorPayload.cause).toEqual({
      status: 500,
      body: "internal server error",
    });
  });

  it("includes `sourceError` when neon-http attaches it as a sidecar", async () => {
    // The neon-http driver attaches the source HTTP response under
    // `.sourceError` on certain failure modes. Surfacing it is the
    // point of issue #974 — a 5xx with no other diagnostic data still
    // leaves a usable trace.
    nextThrowable = Object.assign(new Error("Failed query: ..."), {
      sourceError: { status: 502, statusText: "Bad Gateway" },
    });

    await fetchTokenLabels(createDb("postgres://test"), ["0xabc"]);

    const errorPayload = captureLog().error as Record<string, unknown>;
    expect(errorPayload.sourceError).toEqual({
      status: 502,
      statusText: "Bad Gateway",
    });
  });

  it("survives a circular `cause` without throwing or dropping the log line", async () => {
    // Defensive: if any future error library hands us a self-referential
    // object, `JSON.parse(JSON.stringify(...))` throws and would silently
    // swallow the entire log line. The sanitizer falls back to
    // `String(...)` so the rest of the structured fields still ship.
    const circular: Record<string, unknown> = { status: 500 };
    circular.self = circular;
    nextThrowable = Object.assign(new Error("Failed query: ..."), {
      cause: circular,
    });

    await fetchTokenLabels(createDb("postgres://test"), ["0xabc"]);

    const errorPayload = captureLog().error as Record<string, unknown>;
    // Cause survives as a string fallback, the log line is still valid
    // JSON, and the surrounding fields are intact.
    expect(typeof errorPayload.cause).toBe("string");
    expect(errorPayload.message).toBe("Failed query: ...");
  });

  it("does not pull DATABASE_URL / auth headers off the error object", async () => {
    // Neon HTTP driver does NOT put credentials on errors today (the
    // wrapper message is `Failed query: <SQL>\nparams: <values>` — no
    // connection string, no `Authorization` header), but the issue
    // asked us to assert that contract explicitly so a future driver
    // upgrade can't silently regress. We only surface what's already on
    // the error object, never re-resolve the connection string from the
    // env, so the test is shaped as: "if the driver ever added these
    // fields, they would NOT leak through `logIndexerReadFailure`".
    // Issue #974.
    nextThrowable = Object.assign(
      new Error("Failed query: \n      SELECT 1\nparams: "),
      {
        cause: new Error("HTTP 503"),
        code: "ETIMEDOUT",
        // Fields a future driver might attach but we don't surface:
        databaseUrl: "postgres://user:S3CRET@neon.tech:5432/db",
        config: { connectionString: "postgres://user:S3CRET@neon.tech" },
        headers: { authorization: "Bearer LEAKED-TOKEN" },
      },
    );

    await fetchTokenLabels(createDb("postgres://test"), ["0xabc"]);

    const [raw] = consoleLogSpy.mock.calls[0] as [string];
    // None of the speculative-leak fields should make it into the log
    // line — the logger only walks `name` / `message` / `code` / `cause`
    // / `sourceError`.
    expect(raw).not.toContain("S3CRET");
    expect(raw).not.toContain("LEAKED-TOKEN");
    expect(raw).not.toContain("Authorization");
    expect(raw).not.toContain("authorization");
    expect(raw).not.toContain("connectionString");
    expect(raw).not.toContain("databaseUrl");
  });

  it("falls back to `String(error)` for non-Error throws", async () => {
    // `throw "string literal"` and `throw 42` are both legal. The legacy
    // shape used `String(error)`; we preserve that so callers don't
    // suddenly see `null` when a non-`Error` is thrown.
    nextThrowable = "kaboom";

    await fetchTokenLabels(createDb("postgres://test"), ["0xabc"]);

    expect(captureLog().error).toBe("kaboom");
  });
});
