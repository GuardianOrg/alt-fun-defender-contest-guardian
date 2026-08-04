import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import type { AppBindings } from "../lib/types.js";

// --- DB mocks ---------------------------------------------------------------
// `execute` runs the drift-detection join; `update` chains
// `.set(values).where(cond)` per drifted row. Both are captured so the
// tests can assert the checksum re-derivation and the per-row targeting.

const mockExecute = vi.fn();
const mockUpdate = vi.fn();

vi.mock("../db/client.js", () => ({
  createDb: () => ({
    execute: mockExecute,
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
  mockExecute.mockReset();
  mockUpdate.mockReset();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runCreatorReconcile", () => {
  it("issues no writes when nothing has drifted", async () => {
    mockExecute.mockResolvedValue({ rows: [] });
    const updates = stubUpdates();

    await runCreatorReconcile(makeEnv());

    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(updates).toHaveLength(0);
  });

  // The load-bearing assertion. Ponder stores addresses lowercase, but the
  // list route filters with an exact `eq(tokens.creator, getAddress(input))`,
  // so writing the indexer's value through verbatim would leave the row
  // invisible to the very query this sweep exists to fix.
  it("re-checksums the indexer's lowercase creator before writing", async () => {
    mockExecute.mockResolvedValue({
      rows: [
        {
          address: "0xE1A38D620298290d2d925bDEC280B15a12000000",
          onchain_creator: CHECKSUMMED.toLowerCase(),
        },
      ],
    });
    const updates = stubUpdates();

    await runCreatorReconcile(makeEnv());

    expect(updates).toHaveLength(1);
    expect(updates[0].values).toEqual({ creator: CHECKSUMMED });
  });

  it("keeps going after a per-row failure", async () => {
    mockExecute.mockResolvedValue({
      rows: [
        { address: "0xaaa", onchain_creator: CHECKSUMMED.toLowerCase() },
        { address: "0xbbb", onchain_creator: CHECKSUMMED.toLowerCase() },
      ],
    });
    const updates = stubUpdates(new Set([0]));

    await runCreatorReconcile(makeEnv());

    expect(updates).toHaveLength(2);
  });

  it("returns quietly when the detection query fails", async () => {
    mockExecute.mockRejectedValue(new Error("relation does not exist"));
    const updates = stubUpdates();

    await expect(runCreatorReconcile(makeEnv())).resolves.toBeUndefined();
    expect(updates).toHaveLength(0);
  });

  // `getAddress` throws on a malformed value rather than returning it. One bad
  // indexer row must not abort the whole sweep.
  it("skips a malformed indexer address and still processes the rest", async () => {
    mockExecute.mockResolvedValue({
      rows: [
        { address: "0xaaa", onchain_creator: "not-an-address" },
        { address: "0xbbb", onchain_creator: CHECKSUMMED.toLowerCase() },
      ],
    });
    const updates = stubUpdates();

    await expect(runCreatorReconcile(makeEnv())).resolves.toBeUndefined();

    expect(updates).toHaveLength(1);
    expect(updates[0].values).toEqual({ creator: CHECKSUMMED });
  });

  // The zero-address placeholder is filtered in SQL, not in JS — assert the
  // predicate is actually in the emitted query, since `getAddress()` accepts
  // `address(0)` happily and would write an unclaimable creator through.
  it("excludes the launch placeholder in the detection query", async () => {
    mockExecute.mockResolvedValue({ rows: [] });
    stubUpdates();

    await runCreatorReconcile(makeEnv());

    const query = JSON.stringify(mockExecute.mock.calls[0]?.[0] ?? {});
    expect(query).toContain("fee_recipient");
    expect(query).toContain("0x0000000000000000000000000000000000000000");
    expect(query).toContain("ORDER BY");
  });
});
