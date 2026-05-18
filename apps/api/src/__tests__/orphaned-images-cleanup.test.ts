import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import type { AppBindings } from "../lib/types.js";

// --- DB mocks ---------------------------------------------------------------
// `loadProtectedKeys` makes two queries:
//   1. `select({ imageUrl }).from(tokens)` — every launched token.
//   2. `select({ imageKey }).from(moderationLogs).where(...pending_review)`.
// We model both via a shared chainable `from`/`where` thenable so tests
// can program the two return values per run.

const mockTokenRows = vi.fn<() => Promise<Array<{ imageUrl: string }>>>();
const mockPendingRows = vi.fn<() => Promise<Array<{ imageKey: string }>>>();

vi.mock("../db/client.js", () => ({
  createDb: () => ({
    select: (cols?: Record<string, unknown>) => ({
      from: (_table: unknown) => {
        // Tag the call site by the column projection — the two queries
        // pick disjoint columns so we can route them deterministically.
        const isTokenQuery = cols !== undefined && "imageUrl" in cols;
        if (isTokenQuery) {
          // `tokens` query has no `.where()` — returns the thenable
          // directly.
          return mockTokenRows();
        }
        return {
          where: () => mockPendingRows(),
        };
      },
    }),
  }),
}));

const {
  runOrphanedImagesCleanup,
  shouldRunOrphanedImagesCleanup,
  CLEANUP_HOUR_UTC,
  CLEANUP_MINUTE_UTC,
  GRACE_PERIOD_HOURS,
  MAX_DELETES_PER_RUN,
  MAX_PAGES_PER_RUN,
} = await import("../lib/orphaned-images-cleanup.js");

// --- R2 mocks ---------------------------------------------------------------

interface FakeR2Object {
  key: string;
  uploaded: Date;
}

interface FakeR2ListResult {
  objects: FakeR2Object[];
  truncated: boolean;
  cursor?: string;
}

function makeBucket(
  pages: FakeR2ListResult[],
  opts: { deleteImpl?: (keys: string | string[]) => Promise<void> } = {},
) {
  const listCalls: Array<{ prefix?: string; cursor?: string; limit?: number }> =
    [];
  const deleteCalls: Array<string | string[]> = [];
  let pageIdx = 0;
  const bucket = {
    list: vi
      .fn()
      .mockImplementation(
        (options?: {
          prefix?: string;
          cursor?: string;
          limit?: number;
        }) => {
          listCalls.push(options ?? {});
          const page = pages[pageIdx] ?? {
            objects: [],
            truncated: false,
          };
          pageIdx++;
          return Promise.resolve(page);
        },
      ),
    delete: vi
      .fn()
      .mockImplementation(async (keys: string | string[]) => {
        deleteCalls.push(keys);
        if (opts.deleteImpl) {
          await opts.deleteImpl(keys);
        }
      }),
  };
  return { bucket, listCalls, deleteCalls };
}

function makeEnv(bucket: ReturnType<typeof makeBucket>["bucket"]): AppBindings {
  return {
    DATABASE_URL: "postgres://test",
    BOUNCETECH_DATABASE_URL: "",
    ADMIN_API_KEY: "admin-key",
    IMAGES_BUCKET: bucket as unknown as R2Bucket,
    WEBSOCKET_DO: {} as DurableObjectNamespace,
    WS_IP_LIMITER_DO: {} as DurableObjectNamespace,
    LT_TICKER_DO: {} as DurableObjectNamespace,
    LT_DIRECTORY_POLLER_DO: {} as DurableObjectNamespace,
  };
}

const MS_PER_HOUR = 60 * 60 * 1000;
const onGate = new Date(
  Date.UTC(2026, 5, 15, CLEANUP_HOUR_UTC, CLEANUP_MINUTE_UTC, 30),
);
const offGate = new Date(
  Date.UTC(2026, 5, 15, CLEANUP_HOUR_UTC, CLEANUP_MINUTE_UTC + 1, 0),
);

beforeEach(() => {
  vi.clearAllMocks();
  mockTokenRows.mockResolvedValue([]);
  mockPendingRows.mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("shouldRunOrphanedImagesCleanup", () => {
  it("returns true at the configured UTC hour + minute", () => {
    const at = new Date(
      Date.UTC(2026, 0, 1, CLEANUP_HOUR_UTC, CLEANUP_MINUTE_UTC, 0),
    );
    expect(shouldRunOrphanedImagesCleanup(at)).toBe(true);
  });

  it("returns false at the configured hour, wrong minute", () => {
    const at = new Date(
      Date.UTC(2026, 0, 1, CLEANUP_HOUR_UTC, CLEANUP_MINUTE_UTC + 1, 0),
    );
    expect(shouldRunOrphanedImagesCleanup(at)).toBe(false);
  });

  it("returns false at a different hour", () => {
    const at = new Date(
      Date.UTC(2026, 0, 1, (CLEANUP_HOUR_UTC + 1) % 24, CLEANUP_MINUTE_UTC, 0),
    );
    expect(shouldRunOrphanedImagesCleanup(at)).toBe(false);
  });

  it("runs at a different clock hour than the moderation-logs sweep", () => {
    // Both daily storage-hygiene jobs share the cron tick budget; the
    // schedule deliberately separates them so they don't race on a
    // single tick. Guards against a careless future bump that
    // realigns the two on `03:17 UTC`.
    expect(CLEANUP_HOUR_UTC).not.toBe(3);
  });

  it("returns true regardless of seconds within the gated minute", () => {
    const start = new Date(
      Date.UTC(2026, 0, 1, CLEANUP_HOUR_UTC, CLEANUP_MINUTE_UTC, 0),
    );
    const end = new Date(
      Date.UTC(2026, 0, 1, CLEANUP_HOUR_UTC, CLEANUP_MINUTE_UTC, 59),
    );
    expect(shouldRunOrphanedImagesCleanup(start)).toBe(true);
    expect(shouldRunOrphanedImagesCleanup(end)).toBe(true);
  });
});

describe("runOrphanedImagesCleanup", () => {
  it("returns null and touches nothing outside the daily gate", async () => {
    const { bucket } = makeBucket([]);
    const result = await runOrphanedImagesCleanup(makeEnv(bucket), offGate);
    expect(result).toBeNull();
    expect(bucket.list).not.toHaveBeenCalled();
    expect(bucket.delete).not.toHaveBeenCalled();
    expect(mockTokenRows).not.toHaveBeenCalled();
    expect(mockPendingRows).not.toHaveBeenCalled();
  });

  it("deletes orphans older than the grace period, batched in one call", async () => {
    const old = new Date(onGate.getTime() - (GRACE_PERIOD_HOURS + 1) * MS_PER_HOUR);
    const fresh = new Date(onGate.getTime() - 1 * MS_PER_HOUR);

    const { bucket, deleteCalls } = makeBucket([
      {
        objects: [
          { key: "tokens/orphan-a", uploaded: old },
          { key: "tokens/orphan-b", uploaded: old },
          { key: "tokens/fresh-c", uploaded: fresh },
          { key: "tokens/referenced-d", uploaded: old },
          { key: "tokens/pending-e", uploaded: old },
        ],
        truncated: false,
      },
    ]);

    mockTokenRows.mockResolvedValue([
      { imageUrl: "/images/tokens/referenced-d" },
    ]);
    mockPendingRows.mockResolvedValue([{ imageKey: "tokens/pending-e" }]);

    const result = await runOrphanedImagesCleanup(makeEnv(bucket), onGate);

    expect(result).toEqual({
      scanned: 5,
      candidates: 2,
      deleted: 2,
      deleteFailures: 0,
      pagesProcessed: 1,
      truncated: false,
    });
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0]).toEqual(["tokens/orphan-a", "tokens/orphan-b"]);
  });

  it("never deletes in-grace-window objects, even if unreferenced", async () => {
    // The grace boundary is `now − GRACE_PERIOD_HOURS`. An object
    // uploaded *exactly* at the boundary is still in grace (the
    // implementation uses `>= cutoff`, so equality stays safe).
    const atCutoff = new Date(
      onGate.getTime() - GRACE_PERIOD_HOURS * MS_PER_HOUR,
    );
    const justInside = new Date(atCutoff.getTime() + 1);

    const { bucket } = makeBucket([
      {
        objects: [
          { key: "tokens/cutoff", uploaded: atCutoff },
          { key: "tokens/inside", uploaded: justInside },
        ],
        truncated: false,
      },
    ]);

    const result = await runOrphanedImagesCleanup(makeEnv(bucket), onGate);
    expect(result?.candidates).toBe(0);
    expect(result?.deleted).toBe(0);
    expect(bucket.delete).not.toHaveBeenCalled();
  });

  it("skips referenced images whose imageUrl was stored as an absolute URL", async () => {
    // Defensive against pre-#450 rows or future validator drift —
    // anything matching a real R2 key under `/images/tokens/` must
    // protect the object.
    const old = new Date(onGate.getTime() - 30 * MS_PER_HOUR);
    const { bucket } = makeBucket([
      {
        objects: [{ key: "tokens/legacy-key", uploaded: old }],
        truncated: false,
      },
    ]);

    mockTokenRows.mockResolvedValue([
      { imageUrl: "https://api.alt.fun/images/tokens/legacy-key" },
    ]);

    const result = await runOrphanedImagesCleanup(makeEnv(bucket), onGate);
    expect(result?.candidates).toBe(0);
    expect(bucket.delete).not.toHaveBeenCalled();
  });

  it("ignores tokens with empty imageUrl when building the referenced set", async () => {
    const old = new Date(onGate.getTime() - 30 * MS_PER_HOUR);
    const { bucket, deleteCalls } = makeBucket([
      {
        objects: [{ key: "tokens/loose", uploaded: old }],
        truncated: false,
      },
    ]);
    mockTokenRows.mockResolvedValue([
      { imageUrl: "" },
      { imageUrl: "not-a-url" },
    ]);

    const result = await runOrphanedImagesCleanup(makeEnv(bucket), onGate);
    expect(result?.deleted).toBe(1);
    expect(deleteCalls).toEqual([["tokens/loose"]]);
  });

  it("paginates R2 list calls when the bucket is truncated", async () => {
    const old = new Date(onGate.getTime() - 30 * MS_PER_HOUR);
    const { bucket, listCalls } = makeBucket([
      {
        objects: [{ key: "tokens/a", uploaded: old }],
        truncated: true,
        cursor: "cursor-1",
      },
      {
        objects: [{ key: "tokens/b", uploaded: old }],
        truncated: false,
      },
    ]);

    const result = await runOrphanedImagesCleanup(makeEnv(bucket), onGate);
    expect(result?.scanned).toBe(2);
    expect(result?.deleted).toBe(2);
    expect(result?.pagesProcessed).toBe(2);
    expect(listCalls).toHaveLength(2);
    expect(listCalls[0].cursor).toBeUndefined();
    expect(listCalls[1].cursor).toBe("cursor-1");
  });

  it("stops listing once MAX_PAGES_PER_RUN is reached and flags truncated", async () => {
    const old = new Date(onGate.getTime() - 30 * MS_PER_HOUR);
    // Synthesize MAX_PAGES_PER_RUN + 1 always-truncated pages so the
    // guard bites.
    const pages: FakeR2ListResult[] = Array.from(
      { length: MAX_PAGES_PER_RUN + 1 },
      (_, i) => ({
        objects: [{ key: `tokens/p${i}`, uploaded: old }],
        truncated: true,
        cursor: `c-${i}`,
      }),
    );
    const { bucket } = makeBucket(pages);

    const result = await runOrphanedImagesCleanup(makeEnv(bucket), onGate);
    expect(result?.pagesProcessed).toBe(MAX_PAGES_PER_RUN);
    expect(result?.truncated).toBe(true);
    expect(bucket.list).toHaveBeenCalledTimes(MAX_PAGES_PER_RUN);
  });

  it("caps deletions at MAX_DELETES_PER_RUN and reports candidates beyond the cap", async () => {
    const old = new Date(onGate.getTime() - 30 * MS_PER_HOUR);
    const overflow = 5;
    const objects = Array.from(
      { length: MAX_DELETES_PER_RUN + overflow },
      (_, i) => ({ key: `tokens/orphan-${i}`, uploaded: old }),
    );
    const { bucket, deleteCalls } = makeBucket([
      { objects, truncated: false },
    ]);

    const result = await runOrphanedImagesCleanup(makeEnv(bucket), onGate);
    expect(result?.candidates).toBe(MAX_DELETES_PER_RUN + overflow);
    expect(result?.deleted).toBe(MAX_DELETES_PER_RUN);
    // Single batch since MAX_DELETES_PER_RUN <= DELETE_BATCH_SIZE today.
    const totalDeleted = deleteCalls.reduce(
      (acc, batch) => acc + (Array.isArray(batch) ? batch.length : 1),
      0,
    );
    expect(totalDeleted).toBe(MAX_DELETES_PER_RUN);
  });

  it("caps total delete attempts even when batches fail (no over-budget retries)", async () => {
    // Regression: an earlier version capped on `deleted +
    // toDelete.length`, which let a partial-failure batch silently
    // raise the per-run budget — every fallback failure freed up
    // capacity for another batch. The fix counts *attempts*, so a
    // run with N% batch failures still attempts no more than
    // `MAX_DELETES_PER_RUN` deletes.
    const old = new Date(onGate.getTime() - 30 * MS_PER_HOUR);
    const objects = Array.from(
      { length: MAX_DELETES_PER_RUN + 200 },
      (_, i) => ({ key: `tokens/orphan-${i}`, uploaded: old }),
    );

    let batchAttempts = 0;
    let perKeyAttempts = 0;
    const { bucket } = makeBucket(
      [{ objects, truncated: false }],
      {
        deleteImpl: async (keys) => {
          if (Array.isArray(keys)) {
            batchAttempts++;
            throw new Error("batch failed");
          }
          perKeyAttempts++;
          throw new Error("per-key failed");
        },
      },
    );

    const result = await runOrphanedImagesCleanup(makeEnv(bucket), onGate);

    // Exactly one batch (= `MAX_DELETES_PER_RUN` keys, since
    // `DELETE_BATCH_SIZE === MAX_DELETES_PER_RUN`) and
    // `MAX_DELETES_PER_RUN` per-key fallbacks. The extra 200
    // objects are counted as `candidates` but never enter the
    // delete queue.
    expect(batchAttempts).toBe(1);
    expect(perKeyAttempts).toBe(MAX_DELETES_PER_RUN);
    expect(result?.candidates).toBe(MAX_DELETES_PER_RUN + 200);
    expect(result?.deleted).toBe(0);
    expect(result?.deleteFailures).toBe(MAX_DELETES_PER_RUN);
  });

  it("falls back to per-key deletes when a batch delete throws", async () => {
    const old = new Date(onGate.getTime() - 30 * MS_PER_HOUR);
    let batchAttempt = 0;
    const failingKey = "tokens/b";
    const { bucket, deleteCalls } = makeBucket(
      [
        {
          objects: [
            { key: "tokens/a", uploaded: old },
            { key: failingKey, uploaded: old },
            { key: "tokens/c", uploaded: old },
          ],
          truncated: false,
        },
      ],
      {
        deleteImpl: async (keys) => {
          if (Array.isArray(keys)) {
            batchAttempt++;
            throw new Error("batch failed");
          }
          if (keys === failingKey) {
            throw new Error("per-key failed");
          }
        },
      },
    );

    const result = await runOrphanedImagesCleanup(makeEnv(bucket), onGate);
    expect(batchAttempt).toBe(1);
    expect(result?.deleted).toBe(2);
    expect(result?.deleteFailures).toBe(1);
    expect(deleteCalls).toEqual([
      ["tokens/a", failingKey, "tokens/c"],
      "tokens/a",
      failingKey,
      "tokens/c",
    ]);
  });

  it("only lists R2 under the tokens/ prefix", async () => {
    const { bucket, listCalls } = makeBucket([
      { objects: [], truncated: false },
    ]);
    await runOrphanedImagesCleanup(makeEnv(bucket), onGate);
    expect(listCalls[0]?.prefix).toBe("tokens/");
  });

  it("never deletes pending_review keys, even if expired", async () => {
    const old = new Date(onGate.getTime() - 365 * 24 * MS_PER_HOUR);
    const { bucket } = makeBucket([
      {
        objects: [
          { key: "tokens/pending-x", uploaded: old },
          { key: "tokens/orphan-y", uploaded: old },
        ],
        truncated: false,
      },
    ]);
    mockPendingRows.mockResolvedValue([{ imageKey: "tokens/pending-x" }]);

    const result = await runOrphanedImagesCleanup(makeEnv(bucket), onGate);
    expect(result?.deleted).toBe(1);
    expect(bucket.delete).toHaveBeenCalledWith(["tokens/orphan-y"]);
  });
});
