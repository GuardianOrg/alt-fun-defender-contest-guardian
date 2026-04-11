import { ponder } from "@/generated";
import { LeveragedTokenAbi } from "@launchpad/shared";
import { token, ltExchangeRate } from "../ponder.schema";

ponder.on("ExchangeRatePoller:block", async ({ event, context }) => {
  const { db, client } = context;

  const tokens = await db.sql.select({ ltToken: token.ltToken }).from(token);
  const uniqueLTs = [...new Set(tokens.map((t) => t.ltToken))];

  if (uniqueLTs.length === 0) return;

  const results = await Promise.allSettled(
    uniqueLTs.map((ltAddress) =>
      client.readContract({
        address: ltAddress as `0x${string}`,
        abi: LeveragedTokenAbi,
        functionName: "exchangeRate",
      }),
    ),
  );

  const blockNumber = BigInt(event.block.number);
  const timestamp = BigInt(event.block.timestamp);

  for (let i = 0; i < uniqueLTs.length; i++) {
    const result = results[i];
    if (result.status !== "fulfilled") continue;

    const rate = result.value as bigint;
    const ltAddress = uniqueLTs[i] as `0x${string}`;

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
