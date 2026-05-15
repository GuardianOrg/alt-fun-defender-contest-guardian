import { describe, it, expect } from "vitest";
import { listHandlerNames } from "./mocks/ponder";

// Importing every indexer entry point registers all handlers on the mock
// ponder object. Test relies on those side effects.
await import("../src/bonding");
await import("../src/hyperswap");
await import("../src/feeVault");
await import("../src/botFeeRouter");

/**
 * Sources whose `address` is a Ponder factory. For these, Ponder 0.16's
 * real-time sync has a known bug — see PR description and the doc comment
 * on `ponder.on("HyperSwapPair:Sync")` — that silently drops freshly
 * extracted child addresses from `ponder_sync.factory_addresses` whenever
 * the factory source is registered for ≥2 events. Historical sync dedupes
 * factories by `factory.id` (`sync-historical/index.js` ~L240); real-time
 * does not (`sync-realtime/index.js` `filterBlockEventData`). Until that's
 * fixed upstream, every factory source on this indexer must have exactly
 * one indexing function.
 *
 * This list mirrors the `factory(...)` entries in `ponder.config.ts`. If a
 * new factory source is added to that file, add its name here too — the
 * test below will then fail loudly the moment a second `ponder.on` for
 * that source is registered.
 */
const FACTORY_SOURCE_NAMES = ["Token", "HyperSwapPair"] as const;

describe("Ponder 0.16 real-time factory-dedup workaround", () => {
  it("each factory source has exactly one indexing function", () => {
    const handlers = listHandlerNames();

    // Group `Source:Event` strings by source name so the failure message
    // points at the offending pair without manual inspection.
    const handlersBySource = new Map<string, string[]>();
    for (const name of handlers) {
      const source = name.split(":")[0];
      const list = handlersBySource.get(source) ?? [];
      list.push(name);
      handlersBySource.set(source, list);
    }

    for (const source of FACTORY_SOURCE_NAMES) {
      const sourceHandlers = handlersBySource.get(source) ?? [];
      expect(sourceHandlers, `${source} must have exactly one ponder.on handler — registering a second event on a factory source triggers Ponder 0.16's real-time factory-dedup bug (see PR description). Drop one of: ${sourceHandlers.join(", ")}.`).toHaveLength(1);
    }
  });
});
