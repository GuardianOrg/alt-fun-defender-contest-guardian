import { ponder } from "@/generated";
import { LeveragedTokenAbi } from "@launchpad/shared";
import { eq, or } from "@ponder/core";
import { token, ltExchangeRate, routerTrade } from "../ponder.schema";

/**
 * Cached exchange rates keyed by LT address.
 * Used to skip redundant DB writes when rate hasn't changed.
 */
const lastKnownRates = new Map<string, bigint>();

/**
 * Adaptive polling: skip some block intervals as LT count grows.
 * Returns true if this block should be polled.
 */
let pollCounter = 0;
function shouldPoll(ltCount: number): boolean {
  pollCounter++;
  // Base interval is every block handler invocation (every 10 blocks).
  // Scale down frequency as LT count grows:
  //   ≤10 LTs: poll every invocation
  //   11–25 LTs: poll every 2nd invocation (effectively every 20 blocks)
  //   26–50 LTs: poll every 3rd invocation (effectively every 30 blocks)
  //   51+ LTs: poll every 5th invocation (effectively every 50 blocks)
  let skipFactor = 1;
  if (ltCount > 50) skipFactor = 5;
  else if (ltCount > 25) skipFactor = 3;
  else if (ltCount > 10) skipFactor = 2;

  return pollCounter % skipFactor === 0;
}

ponder.on("ExchangeRatePoller:block", async ({ event, context }) => {
  const { db, client } = context;

  const ltRows = await db.sql.selectDistinct({ ltToken: token.ltToken }).from(token);

  if (ltRows.length === 0) return;

  // Adaptive interval: skip this invocation if LT count is high
  if (!shouldPoll(ltRows.length)) return;

  const blockNumber = BigInt(event.block.number);
  const timestamp = BigInt(event.block.timestamp);

  // Determine active LTs: those with at least one non-graduated token,
  // or with recent router trades on any associated token.
  const nonGraduatedLts = await db.sql
    .selectDistinct({ ltToken: token.ltToken })
    .from(token)
    .where(eq(token.graduated, false));

  const nonGraduatedSet = new Set(nonGraduatedLts.map((r) => r.ltToken));

  // For graduated-only LTs, check for recent trade activity
  const graduatedOnlyLts = ltRows.filter((r) => !nonGraduatedSet.has(r.ltToken));

  const activeLtSet = new Set(nonGraduatedSet);

  if (graduatedOnlyLts.length > 0) {
    // Find tokens associated with graduated-only LTs that had recent trades
    for (const { ltToken } of graduatedOnlyLts) {
      const tokensForLt = await db.sql
        .select({ address: token.address })
        .from(token)
        .where(eq(token.ltToken, ltToken));

      if (tokensForLt.length === 0) continue;

      // Check if any of these tokens had recent router trades
      const conditions = tokensForLt.map((t) => eq(routerTrade.tokenAddress, t.address));
      const recentTrades = await db.sql
        .select({ id: routerTrade.id })
        .from(routerTrade)
        .where(or(...conditions))
        .limit(1);

      if (recentTrades.length > 0) {
        activeLtSet.add(ltToken);
      }
    }
  }

  const activeLts = ltRows.filter((r) => activeLtSet.has(r.ltToken));

  if (activeLts.length === 0) return;

  // Batch all exchange rate reads into a single multicall RPC request
  const results = await client.multicall({
    contracts: activeLts.map(({ ltToken }) => ({
      address: ltToken as `0x${string}`,
      abi: LeveragedTokenAbi,
      functionName: "exchangeRate" as const,
    })),
    allowFailure: true,
  });

  for (let i = 0; i < activeLts.length; i++) {
    const result = results[i];
    if (result.status !== "success") continue;

    const rate = result.result as bigint;
    const ltAddress = activeLts[i].ltToken as `0x${string}`;

    // Cache check: skip DB write if rate hasn't changed since last poll
    const lastRate = lastKnownRates.get(ltAddress);
    if (lastRate !== undefined && lastRate === rate) continue;

    lastKnownRates.set(ltAddress, rate);

    await db
      .insert(ltExchangeRate)
      .values({
        id: `${ltAddress}-${blockNumber}`,
        ltAddress,
        rate,
        blockNumber,
        timestamp,
      })
      .onConflictDoNothing();
  }
});
