import { beforeEach } from "vitest";

import { _resetAllIsolateTtlCaches } from "../utils/isolate-ttl-cache.js";

/**
 * Vitest global setup. Drops every per-isolate TTL cache before each
 * test so a value memoised by one case never bleeds into another (test
 * files routinely swap mock return values between cases via
 * `mockResolvedValueOnce` chains, and those expectations require the
 * wrapper to actually call the underlying fetcher each time).
 *
 * Pulled through the registry in `utils/isolate-ttl-cache.ts` rather
 * than from `indexer-cached-reads.ts`, deliberately, so this setup
 * never imports `indexer-reads.js`. Importing it here would resolve the
 * real module before downstream test files get to call `vi.mock` on it,
 * and their mocks would silently no-op.
 *
 * The production isolate doesn't see this hook — `setupFiles` in
 * `vitest.config.ts` is test-only.
 */
beforeEach(() => {
  _resetAllIsolateTtlCaches();
});
