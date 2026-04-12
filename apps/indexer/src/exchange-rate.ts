import { ponder } from "@/generated";
import { LeveragedTokenAbi } from "@launchpad/shared";
import { token, ltExchangeRate } from "../ponder.schema";

ponder.on("ExchangeRatePoller:block", async ({ event, context }) => {
  const { db, client } = context;

  const ltRows = await db.sql.selectDistinct({ ltToken: token.ltToken }).from(token);

  if (ltRows.length === 0) return;

  const results = await Promise.allSettled(
    ltRows.map(({ ltToken }) =>
      client.readContract({
        address: ltToken as `0x${string}`,
        abi: LeveragedTokenAbi,
        functionName: "exchangeRate",
      }),
    ),
  );

  const blockNumber = BigInt(event.block.number);
  const timestamp = BigInt(event.block.timestamp);

  for (let i = 0; i < ltRows.length; i++) {
    const result = results[i];
    if (result.status !== "fulfilled") continue;

    const rate = result.value as bigint;
    const ltAddress = ltRows[i].ltToken as `0x${string}`;

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
