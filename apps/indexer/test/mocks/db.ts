import { vi } from "vitest";

/**
 * `JSON.stringify` doesn't serialise BigInt, but several schemas key by
 * bigint (e.g. `hourlyVolume.hourStart`). Stringify with a `${value}n`
 * marker so distinct bigints produce distinct map keys without crashing.
 */
function stringifyKey(table: unknown, key: unknown): string {
  return JSON.stringify(
    { table: (table as { _?: { name?: string } })?._?.name ?? "_", key },
    (_, value) => (typeof value === "bigint" ? `${value}n` : value),
  );
}

/**
 * Creates a mock Ponder db object that tracks insert/update calls.
 * Each insert() returns a chainable object with .values() and .onConflictDoNothing()/.onConflictDoUpdate().
 * Each update() returns a chainable object with .set().
 */
export function createMockDb() {
  const insertCalls: { table: unknown; values: unknown; conflict: "doNothing" | "doUpdate"; conflictValues?: unknown }[] = [];
  const updateCalls: { table: unknown; key: unknown; values: unknown }[] = [];
  const findResults = new Map<string, unknown>();

  const mockDb = {
    find: vi.fn(async (table: unknown, key: unknown) => {
      const mapKey = stringifyKey(table, key);
      return findResults.get(mapKey) ?? null;
    }),
    /** Test hook: seed a row so the next `find(table, key)` returns `value`. */
    _setFindResult: (table: unknown, key: unknown, value: unknown) => {
      const mapKey = stringifyKey(table, key);
      findResults.set(mapKey, value);
    },
    insert: vi.fn((table: unknown) => {
      const entry: (typeof insertCalls)[number] = { table, values: undefined, conflict: "doNothing" };
      insertCalls.push(entry);
      return {
        values: vi.fn((vals: unknown) => {
          entry.values = vals;
          return {
            onConflictDoNothing: vi.fn(() => {
              entry.conflict = "doNothing";
            }),
            onConflictDoUpdate: vi.fn((conflictVals: unknown) => {
              entry.conflict = "doUpdate";
              entry.conflictValues = conflictVals;
            }),
          };
        }),
      };
    }),
    update: vi.fn((table: unknown, key: unknown) => {
      const entry: (typeof updateCalls)[number] = { table, key, values: undefined };
      updateCalls.push(entry);
      return {
        set: vi.fn((vals: unknown) => {
          entry.values = vals;
        }),
      };
    }),
    _insertCalls: insertCalls,
    _updateCalls: updateCalls,
  };

  return mockDb;
}

/** Minimal event factory for Bonding/Router events. */
export function createMockEvent(overrides: {
  args?: Record<string, unknown>;
  blockNumber?: bigint;
  blockTimestamp?: bigint;
  txHash?: string;
  txFrom?: string;
  logIndex?: number;
  logAddress?: string;
}) {
  return {
    args: overrides.args ?? {},
    block: {
      number: overrides.blockNumber ?? 100n,
      timestamp: overrides.blockTimestamp ?? 1000n,
    },
    transaction: {
      hash: overrides.txHash ?? "0xabc123",
      from: overrides.txFrom ?? "0xsender",
    },
    log: {
      logIndex: overrides.logIndex ?? 0,
      address: overrides.logAddress ?? "0xpair",
      transactionHash: overrides.txHash ?? "0xabc123",
    },
  };
}
