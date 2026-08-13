import { eq, sql, type SQL } from "drizzle-orm";

import { ltDirectory, tokens } from "../db/schema.js";

/**
 * Exclude tokens whose BounceTech LT is mint-paused.
 *
 * Compared case-insensitively because `tokens.lt_pair` has historically
 * been written both checksummed and lowercased, while `lt_directory.address`
 * is checksummed by the poller. A missing directory row does not match,
 * so unknown LTs stay visible (we cannot prove they are paused).
 */
export function notMintPausedLt(): SQL {
  return sql`not exists (
    select 1 from ${ltDirectory}
    where lower(${ltDirectory.address}) = lower(${tokens.ltPair})
      and ${ltDirectory.mintPaused} = true
  )`;
}

/** Public catalogue lens: not admin-hidden and not sitting on a paused LT. */
export function publicVisibleTokenConditions(): SQL[] {
  return [eq(tokens.isHidden, false), notMintPausedLt()];
}
