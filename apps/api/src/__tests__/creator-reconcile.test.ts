import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import type { AppBindings } from "../lib/types.js";

// --- DB mocks ---------------------------------------------------------------
// The drift detection is a Drizzle chain
// (`select().from().innerJoin().where().orderBy().limit()`); the per-row write
// chains `update().set().where()`. Both are stubbed so the tests can assert
// the checksum re-derivation, the per-row targeting, and the WHERE predicate.

const mockUpdate = vi.fn();

/** Rows the stubbed detection query resolves to. */
let detectRows: Array<{ address: string; onchainCreator: string }> = [];
/** Set when detection should blow up, mimicking a missing relation. */
let detectError: Error | null = null;
/** The `where(...)` argument Drizzle built, for predicate assertions. */
let capturedWhere: unknown = null;

const mockSelect = vi.fn(() => ({
  from: () => ({
    innerJoin: () => ({
      where: (whereExpr: unknown) => {
        capturedWhere = whereExpr;
        return {
          orderBy: () => ({
            limit: () =>
              detectError ? Promise.reject(detectError) : Promise.resolve(detectRows),
          }),
        };
      },
    }),
  }),
}));

vi.mock("../db/client.js", () => ({
  createDb: () => ({
    select: mockSelect,
    update: mockUpdate,
  }),
}));

const { runCreatorReconcile } = await import("../lib/creator-reconcile.js");

function makeEnv(): AppBindings {
  return {
    DATABASE_URL: "postgres://test",
    BOUNCETECH_DATABASE_URL: "",
    ADMIN_API_KEY: "admin-key",
    IMAGES_BUCKET: {} as R2Bucket,
    WEBSOCKET_DO: {} as DurableObjectNamespace,
    WS_IP_LIMITER_DO: {} as DurableObjectNamespace,
    LT_TICKER_DO: {} as DurableObjectNamespace,
    LT_DIRECTORY_POLLER_DO: {} as DurableObjectNamespace,
  };
}

interface UpdateCall {
  values: Record<string, unknown>;
  where: unknown;
}

function stubUpdates(failures: Set<number> = new Set()): UpdateCall[] {
  const captured: UpdateCall[] = [];
  mockUpdate.mockImplementation(() => ({
    set: (values: Record<string, unknown>) => ({
      where: (whereExpr: unknown) => {
        const index = captured.length;
        captured.push({ values, where: whereExpr });
        return failures.has(index)
          ? Promise.reject(new Error("update failed"))
          : Promise.resolve([]);
      },
    }),
  }));
  return captured;
}

const CHECKSUMMED = "0x2C8496Bce4aee5Ce4Af571E02543937fb38b244E";

beforeEach(() => {
  mockSelect.mockClear();
  mockUpdate.mockReset();
  detectRows = [];
  detectError = null;
  capturedWhere = null;
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runCreatorReconcile", () => {
  it("issues no writes when nothing has drifted", async () => {
    const updates = stubUpdates();

    await runCreatorReconcile(makeEnv());

    expect(mockSelect).toHaveBeenCalledTimes(1);
    expect(updates).toHaveLength(0);
  });

  // The load-bearing assertion. Ponder stores addresses lowercase, but the
  // list route filters with an exact `eq(tokens.creator, getAddress(input))`,
  // so writing the indexer's value through verbatim would leave the row
  // invisible to the very query this sweep exists to fix.
  it("re-checksums the indexer's lowercase creator before writing", async () => {
    detectRows = [
      {
        address: "0xE1A38D620298290d2d925bDEC280B15a12000000",
        onchainCreator: CHECKSUMMED.toLowerCase(),
      },
    ];
    const updates = stubUpdates();

    await runCreatorReconcile(makeEnv());

    expect(updates).toHaveLength(1);
    expect(updates[0].values).toEqual({ creator: CHECKSUMMED });
  });

  it("keeps going after a per-row failure", async () => {
    detectRows = [
      { address: "0xaaa", onchainCreator: CHECKSUMMED.toLowerCase() },
      { address: "0xbbb", onchainCreator: CHECKSUMMED.toLowerCase() },
    ];
    const updates = stubUpdates(new Set([0]));

    await runCreatorReconcile(makeEnv());

    expect(updates).toHaveLength(2);
  });

  it("returns quietly when the detection query fails", async () => {
    detectError = new Error("relation does not exist");
    const updates = stubUpdates();

    await expect(runCreatorReconcile(makeEnv())).resolves.toBeUndefined();
    expect(updates).toHaveLength(0);
  });

  // `getAddress` throws on a malformed value rather than returning it. One bad
  // indexer row must not abort the whole sweep.
  it("skips a malformed indexer address and still processes the rest", async () => {
    detectRows = [
      { address: "0xaaa", onchainCreator: "not-an-address" },
      { address: "0xbbb", onchainCreator: CHECKSUMMED.toLowerCase() },
    ];
    const updates = stubUpdates();

    await expect(runCreatorReconcile(makeEnv())).resolves.toBeUndefined();

    expect(updates).toHaveLength(1);
    expect(updates[0].values).toEqual({ creator: CHECKSUMMED });
  });

  // The placeholder row `Factory:PairCreated` writes before `TokenLaunched`
  // lands carries `address(0)`, which `getAddress()` accepts happily — so it
  // has to be excluded in the query or a token caught mid-launch gets an
  // unclaimable creator. Asserted on the built predicate because there's no
  // JS-side guard to test.
  it("excludes the launch placeholder in the detection predicate", async () => {
    stubUpdates();

    await runCreatorReconcile(makeEnv());

    // Render the predicate exactly as the driver would, so this checks the
    // real emitted SQL rather than an incidental object shape.
    const { sql: text, params } = new PgDialect().sqlToQuery(capturedWhere as SQL);

    expect(params).toContain("0x0000000000000000000000000000000000000000");
    // Case-insensitive on both sides, else every checksummed row reads as drift.
    expect(text).toContain("lower");
    expect(text).toContain("fee_recipient");
  });
});
