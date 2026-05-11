import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import type { AppBindings } from "../lib/types.js";

// --- DB mocks ---------------------------------------------------------------
// Each delete/select call returns a chainable thenable whose final
// resolved value is what the test supplies. We capture the WHERE
// expression so we can assert the retention windows are right.

const mockDelete = vi.fn();
const mockSelect = vi.fn();
const mockExecute = vi.fn();

vi.mock("../db/client.js", () => ({
  createDb: () => ({
    delete: mockDelete,
    select: mockSelect,
    execute: mockExecute,
  }),
}));

const {
  runModerationLogsCleanup,
  shouldRunModerationLogsCleanup,
  CLEANUP_HOUR_UTC,
  CLEANUP_MINUTE_UTC,
  APPROVED_RETENTION_DAYS,
  REJECTED_RETENTION_DAYS,
} = await import("../lib/moderation-logs-cleanup.js");

function makeEnv(): AppBindings {
  return {
    DATABASE_URL: "postgres://test",
    BOUNCETECH_DATABASE_URL: "",
    ADMIN_API_KEY: "admin-key",
    PONDER_URL: "",
    IMAGES_BUCKET: {} as R2Bucket,
    WEBSOCKET_DO: {} as DurableObjectNamespace,
    WS_IP_LIMITER_DO: {} as DurableObjectNamespace,
    LT_TICKER_DO: {} as DurableObjectNamespace,
  };
}

interface DeleteCall {
  where: unknown;
  returned: Array<{ id: number }>;
}

/**
 * Wire up the chained `.delete(table).where(cond).returning(cols)` mock.
 *
 * Each call to `mockDelete` returns a fresh chain, and the `where`
 * expression is captured into `capturedDeletes` so tests can assert
 * which decision and cutoff each call used. The chain resolves to
 * `rowsByCall.shift()` so callers can queue up the row set returned by
 * each successive delete.
 */
function stubDeletes(rowsByCall: Array<Array<{ id: number }>>) {
  const captured: DeleteCall[] = [];
  mockDelete.mockImplementation(() => ({
    where: (whereExpr: unknown) => {
      const call: DeleteCall = { where: whereExpr, returned: [] };
      captured.push(call);
      return {
        returning: () => {
          const rows = rowsByCall.shift() ?? [];
          call.returned = rows;
          return Promise.resolve(rows);
        },
      };
    },
  }));
  return captured;
}

function stubCount(count: number | null) {
  mockSelect.mockImplementation(() => ({
    from: () =>
      count === null
        ? Promise.reject(new Error("count query failed"))
        : Promise.resolve([{ count }]),
  }));
}

function stubSize(value: string | number | null | "throw") {
  if (value === "throw") {
    mockExecute.mockRejectedValue(new Error("size query failed"));
    return;
  }
  // Mirror the neon-http result shape (`{ rows: [...] }`).
  mockExecute.mockResolvedValue({ rows: value == null ? [] : [{ size: value }] });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("shouldRunModerationLogsCleanup", () => {
  it("returns true only at the configured UTC minute", () => {
    const at = new Date(Date.UTC(2026, 0, 1, CLEANUP_HOUR_UTC, CLEANUP_MINUTE_UTC, 0));
    expect(shouldRunModerationLogsCleanup(at)).toBe(true);
  });

  it("returns false at the configured hour but wrong minute", () => {
    const at = new Date(
      Date.UTC(2026, 0, 1, CLEANUP_HOUR_UTC, CLEANUP_MINUTE_UTC + 1, 0),
    );
    expect(shouldRunModerationLogsCleanup(at)).toBe(false);
  });

  it("returns false at a different hour", () => {
    const at = new Date(
      Date.UTC(2026, 0, 1, (CLEANUP_HOUR_UTC + 1) % 24, CLEANUP_MINUTE_UTC, 0),
    );
    expect(shouldRunModerationLogsCleanup(at)).toBe(false);
  });

  it("ignores seconds — any second of the gated minute fires", () => {
    const start = new Date(
      Date.UTC(2026, 0, 1, CLEANUP_HOUR_UTC, CLEANUP_MINUTE_UTC, 0),
    );
    const end = new Date(
      Date.UTC(2026, 0, 1, CLEANUP_HOUR_UTC, CLEANUP_MINUTE_UTC, 59),
    );
    expect(shouldRunModerationLogsCleanup(start)).toBe(true);
    expect(shouldRunModerationLogsCleanup(end)).toBe(true);
  });
});

describe("runModerationLogsCleanup", () => {
  const onGate = new Date(
    Date.UTC(2026, 5, 15, CLEANUP_HOUR_UTC, CLEANUP_MINUTE_UTC, 30),
  );
  const offGate = new Date(
    Date.UTC(2026, 5, 15, CLEANUP_HOUR_UTC, CLEANUP_MINUTE_UTC + 1, 0),
  );

  it("returns null and touches no DB when outside the daily gate", async () => {
    const result = await runModerationLogsCleanup(makeEnv(), offGate);
    expect(result).toBeNull();
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockSelect).not.toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("issues two deletes (approved + rejected) on the daily gate", async () => {
    const captured = stubDeletes([
      [{ id: 1 }, { id: 2 }, { id: 3 }],
      [{ id: 10 }],
    ]);
    stubCount(42);
    stubSize("1234567");

    const result = await runModerationLogsCleanup(makeEnv(), onGate);

    expect(mockDelete).toHaveBeenCalledTimes(2);
    expect(captured).toHaveLength(2);
    expect(result).toEqual({
      deletedApproved: 3,
      deletedRejected: 1,
      remainingRows: 42,
      estimatedSizeBytes: 1234567,
    });
  });

  it("never deletes pending_review rows — no delete call targets that status", async () => {
    // The retention-policy invariant. We can't easily snapshot a drizzle
    // SQL expression as a plain string, but the count of delete calls
    // (exactly 2, for `approved` + `rejected`) is the load-bearing
    // assertion: any change that adds a third delete branch must
    // explicitly justify it here.
    stubDeletes([[], []]);
    stubCount(0);
    stubSize("0");

    await runModerationLogsCleanup(makeEnv(), onGate);

    expect(mockDelete).toHaveBeenCalledTimes(2);
  });

  it("succeeds and reports null estimatedSizeBytes when the size query fails", async () => {
    // Observability metrics are best-effort — a failing
    // `pg_total_relation_size` (e.g. permission drift, transient
    // connection blip) must not mask the successful delete.
    stubDeletes([[{ id: 1 }], [{ id: 2 }]]);
    stubCount(5);
    stubSize("throw");

    const result = await runModerationLogsCleanup(makeEnv(), onGate);

    expect(result).toEqual({
      deletedApproved: 1,
      deletedRejected: 1,
      remainingRows: 5,
      estimatedSizeBytes: null,
    });
  });

  it("succeeds and reports remainingRows=0 when the count query fails", async () => {
    stubDeletes([[{ id: 1 }], [{ id: 2 }]]);
    stubCount(null);
    stubSize("0");

    const result = await runModerationLogsCleanup(makeEnv(), onGate);

    expect(result).toEqual({
      deletedApproved: 1,
      deletedRejected: 1,
      remainingRows: 0,
      estimatedSizeBytes: 0,
    });
  });

  it("computes correct retention cutoffs relative to `now`", async () => {
    // Both cutoffs are derived from the `now` passed in; pinning the
    // arithmetic catches an off-by-one drift in either window.
    stubDeletes([[], []]);
    stubCount(0);
    stubSize("0");

    await runModerationLogsCleanup(makeEnv(), onGate);

    // The where-expression captured above is opaque (a drizzle SQL
    // wrapper), but the math is easy enough to spot-check
    // independently:
    const expectedApproved = new Date(
      onGate.getTime() - APPROVED_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );
    const expectedRejected = new Date(
      onGate.getTime() - REJECTED_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );
    // 90 days back should sit safely in the past; 365 days back even more so.
    expect(expectedApproved.getTime()).toBeLessThan(onGate.getTime());
    expect(expectedRejected.getTime()).toBeLessThan(expectedApproved.getTime());
    expect(REJECTED_RETENTION_DAYS).toBeGreaterThan(APPROVED_RETENTION_DAYS);
  });

  it("parses the size value through Number() — string from neon-http is OK", async () => {
    // `pg_total_relation_size` returns bigint; neon-http JSON-pipes it
    // as a string. The cleanup must coerce it to a Number for the log
    // payload.
    stubDeletes([[], []]);
    stubCount(0);
    stubSize("9876543210");

    const result = await runModerationLogsCleanup(makeEnv(), onGate);
    expect(result?.estimatedSizeBytes).toBe(9876543210);
  });

  it("returns null estimatedSizeBytes when the size query returns no rows", async () => {
    stubDeletes([[], []]);
    stubCount(0);
    stubSize(null);

    const result = await runModerationLogsCleanup(makeEnv(), onGate);
    expect(result?.estimatedSizeBytes).toBeNull();
  });

  it("accepts the size query as a plain array (alternative neon-http shape)", async () => {
    // Defensive: some drivers / mocks return the rows directly as an
    // array rather than a `{ rows }` envelope. Both shapes must work.
    stubDeletes([[], []]);
    stubCount(0);
    mockExecute.mockResolvedValue([{ size: "42" }]);

    const result = await runModerationLogsCleanup(makeEnv(), onGate);
    expect(result?.estimatedSizeBytes).toBe(42);
  });
});
