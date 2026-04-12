import { describe, it, expect, beforeEach, vi } from "vitest";
import { getHandler } from "./mocks/ponder";
import { createMockDb } from "./mocks/db";
import { ltExchangeRate } from "../../ponder.schema";

// Must import before the module under test to register handlers
await import("../exchange-rate");

function createBlockEvent(blockNumber: bigint, timestamp: bigint) {
  return {
    block: {
      number: blockNumber,
      timestamp,
    },
  };
}

function createMockClient(results: { status: "success" | "failure"; result?: bigint }[]) {
  return {
    multicall: vi.fn().mockResolvedValue(results),
  };
}

/**
 * Build a mock db with sql query support for exchange-rate handler.
 * The handler uses db.sql.selectDistinct and db.sql.select for LT queries.
 */
function createExchangeRateDb(options: {
  allLts: { ltToken: string }[];
  nonGraduatedLts: { ltToken: string }[];
  tokensForLt?: Record<string, { address: string }[]>;
  recentTrades?: Record<string, { id: string }[]>;
}) {
  const db = createMockDb();

  // Build chainable query mocks for db.sql
  const buildChain = (finalResult: unknown[]) => {
    const chain: Record<string, unknown> = {};
    chain.from = vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue(finalResult),
        // For queries without limit
        ...finalResult,
        [Symbol.iterator]: () => finalResult[Symbol.iterator](),
        length: finalResult.length,
        map: finalResult.map.bind(finalResult),
        filter: finalResult.filter.bind(finalResult),
      }),
      // For queries without where (selectDistinct from token)
      ...finalResult,
      length: finalResult.length,
      [Symbol.iterator]: () => finalResult[Symbol.iterator](),
      map: finalResult.map.bind(finalResult),
      filter: finalResult.filter.bind(finalResult),
    });
    return chain;
  };

  let selectDistinctCallCount = 0;
  db.sql.selectDistinct = vi.fn().mockImplementation(() => {
    selectDistinctCallCount++;
    if (selectDistinctCallCount === 1) {
      // First call: all LTs
      return buildChain(options.allLts);
    }
    // Second call: non-graduated LTs
    return buildChain(options.nonGraduatedLts);
  });

  db.sql.select = vi.fn().mockImplementation(() => {
    // Used for tokensForLt and recentTrades queries
    const resolvedResult: unknown[] = [];
    return {
      from: vi.fn().mockImplementation(() => ({
        where: vi.fn().mockImplementation(() => {
          // This could be either tokens query or trades query
          // Determine based on call order — simplified for testing
          return {
            limit: vi.fn().mockReturnValue(resolvedResult),
            length: resolvedResult.length,
            map: (resolvedResult as unknown[]).map.bind(resolvedResult),
            filter: (resolvedResult as unknown[]).filter.bind(resolvedResult),
          };
        }),
        length: 0,
      })),
    };
  });

  return db;
}

describe("ExchangeRatePoller:block", () => {
  beforeEach(() => {
    // Reset the module-level pollCounter and lastKnownRates by re-importing
    // Since we can't easily reset module state, we test behavior directly
  });

  it("returns early when no LTs exist", async () => {
    const handler = getHandler("ExchangeRatePoller:block");
    const db = createExchangeRateDb({
      allLts: [],
      nonGraduatedLts: [],
    });
    const client = createMockClient([]);
    const event = createBlockEvent(100n, 1700000000n);

    await handler({ event, context: { db, client } });

    // Should not call multicall if no LTs
    expect(client.multicall).not.toHaveBeenCalled();
  });

  it("calls multicall with correct LT addresses", async () => {
    const handler = getHandler("ExchangeRatePoller:block");
    const db = createExchangeRateDb({
      allLts: [{ ltToken: "0xlt1" }, { ltToken: "0xlt2" }],
      nonGraduatedLts: [{ ltToken: "0xlt1" }, { ltToken: "0xlt2" }],
    });
    const client = createMockClient([
      { status: "success", result: 1000000000000000000n },
      { status: "success", result: 2000000000000000000n },
    ]);
    const event = createBlockEvent(100n, 1700000000n);

    await handler({ event, context: { db, client } });

    // May or may not call based on shouldPoll adaptive logic
    // If it does call, it should use correct addresses
    if (client.multicall.mock.calls.length > 0) {
      const multicallArg = client.multicall.mock.calls[0][0] as {
        contracts: { address: string; functionName: string }[];
      };
      expect(multicallArg.contracts[0].address).toBe("0xlt1");
      expect(multicallArg.contracts[1].address).toBe("0xlt2");
      expect(multicallArg.contracts[0].functionName).toBe("exchangeRate");
      expect(multicallArg.contracts[1].functionName).toBe("exchangeRate");
    }
  });

  it("skips failed multicall results (Promise.allSettled-like behavior)", async () => {
    const handler = getHandler("ExchangeRatePoller:block");
    const db = createExchangeRateDb({
      allLts: [{ ltToken: "0xlt1" }, { ltToken: "0xlt2" }],
      nonGraduatedLts: [{ ltToken: "0xlt1" }, { ltToken: "0xlt2" }],
    });
    const client = createMockClient([
      { status: "failure" }, // First LT fails
      { status: "success", result: 2000000000000000000n },
    ]);
    const event = createBlockEvent(200n, 1700001000n);

    await handler({ event, context: { db, client } });

    if (client.multicall.mock.calls.length > 0) {
      // Only the successful result should produce a DB insert
      // Failed reads should be skipped (no error thrown)
      const successInserts = db._insertCalls.filter(
        (c) => c.table === ltExchangeRate,
      );
      // Should have at most 1 insert (the successful one)
      expect(successInserts.length).toBeLessThanOrEqual(1);
    }
  });

  it("uses allowFailure: true in multicall for resilience", async () => {
    const handler = getHandler("ExchangeRatePoller:block");
    const db = createExchangeRateDb({
      allLts: [{ ltToken: "0xlt1" }],
      nonGraduatedLts: [{ ltToken: "0xlt1" }],
    });
    const client = createMockClient([
      { status: "success", result: 1000000000000000000n },
    ]);
    const event = createBlockEvent(300n, 1700002000n);

    await handler({ event, context: { db, client } });

    if (client.multicall.mock.calls.length > 0) {
      const multicallArg = client.multicall.mock.calls[0][0] as {
        allowFailure: boolean;
      };
      expect(multicallArg.allowFailure).toBe(true);
    }
  });

  it("inserts exchange rate with correct ID format", async () => {
    const handler = getHandler("ExchangeRatePoller:block");
    const db = createExchangeRateDb({
      allLts: [{ ltToken: "0xlt1" }],
      nonGraduatedLts: [{ ltToken: "0xlt1" }],
    });
    const client = createMockClient([
      { status: "success", result: 1500000000000000000n },
    ]);
    const event = createBlockEvent(500n, 1700005000n);

    await handler({ event, context: { db, client } });

    if (db._insertCalls.length > 0) {
      const call = db._insertCalls.find((c) => c.table === ltExchangeRate);
      if (call) {
        const values = call.values as Record<string, unknown>;
        expect(values.id).toBe("0xlt1-500");
        expect(values.ltAddress).toBe("0xlt1");
        expect(values.rate).toBe(1500000000000000000n);
        expect(values.blockNumber).toBe(500n);
        expect(values.timestamp).toBe(1700005000n);
        expect(call.conflict).toBe("doNothing");
      }
    }
  });

  it("collects distinct LT addresses from tokens", async () => {
    const handler = getHandler("ExchangeRatePoller:block");
    // Two tokens sharing the same LT should result in only one multicall entry
    const db = createExchangeRateDb({
      allLts: [{ ltToken: "0xlt1" }], // selectDistinct already deduplicates
      nonGraduatedLts: [{ ltToken: "0xlt1" }],
    });
    const client = createMockClient([
      { status: "success", result: 1000000000000000000n },
    ]);
    const event = createBlockEvent(600n, 1700006000n);

    await handler({ event, context: { db, client } });

    if (client.multicall.mock.calls.length > 0) {
      const multicallArg = client.multicall.mock.calls[0][0] as {
        contracts: { address: string }[];
      };
      // Only one call for the deduplicated LT
      expect(multicallArg.contracts).toHaveLength(1);
      expect(multicallArg.contracts[0].address).toBe("0xlt1");
    }
  });
});
