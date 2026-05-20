import {
  BOUNCE_INDEXING_API,
  filterSupportedLTs,
  type LeveragedTokenInfo,
  type LiveLeveragedToken,
} from "@launchpad/shared";

import { info, section, success } from "./logger.ts";

/**
 * Timeout for the upstream BounceTech indexing API directory fetch.
 * One shot at startup, so a 10s ceiling is a fail-fast threshold rather
 * than a tight latency budget.
 */
const DIRECTORY_FETCH_TIMEOUT_MS = 10_000;

/**
 * Fetch the live BounceTech LT directory and narrow to LTs that are:
 *
 *   1. In Alt Fun's supported asset / leverage universe (`filterSupportedLTs`
 *      already drops `EXCLUDED_UNDERLYING_ASSETS` like PAXG and any asset
 *      tuple we haven't whitelisted).
 *   2. Not currently mint-paused on BounceTech — the seed buy that every
 *      `createToken` iteration runs would revert otherwise, silently
 *      degrading the harness to "100% failures".
 */
export async function loadTradableLTs(): Promise<LeveragedTokenInfo[]> {
  section("📋", "LT pool");
  info("Fetching BounceTech directory…");

  const res = await fetch(`${BOUNCE_INDEXING_API}/leveraged-tokens`, {
    signal: AbortSignal.timeout(DIRECTORY_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(
      `BounceTech indexing API error: ${res.status} ${res.statusText}`,
    );
  }
  const body = (await res.json()) as { data: LiveLeveragedToken[] };
  const tradable = filterSupportedLTs(body.data).filter((lt) => !lt.mintPaused);
  const dropped = body.data.length - tradable.length;
  success(
    `${tradable.length} tradable` + (dropped > 0 ? `, ${dropped} dropped` : ""),
  );

  if (tradable.length === 0) {
    throw new Error(
      "No tradable BounceTech LTs found — every supported pair is either missing or mint-paused.",
    );
  }

  return tradable.map((lt) => ({
    address: lt.address,
    symbol: lt.symbol,
    name: lt.name,
    targetAsset: lt.targetAsset,
    targetLeverage: lt.targetLeverage,
    isLong: lt.isLong,
    decimals: lt.decimals,
  }));
}

export function pickRandomLT(
  lts: readonly LeveragedTokenInfo[],
): LeveragedTokenInfo {
  if (lts.length === 0) throw new Error("LT pool is empty");
  return lts[Math.floor(Math.random() * lts.length)]!;
}
