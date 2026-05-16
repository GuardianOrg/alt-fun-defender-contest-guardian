import { describe, it, expect, beforeEach } from "vitest";
import { getHandler } from "./mocks/ponder";
import { createMockDb, createMockEvent } from "./mocks/db";
import {
  creatorEarnings,
  feeAccrual,
  feeClaim,
  token,
} from "../ponder.schema";

await import("../src/feeVault");

describe("FeeVault:FeeAccrued", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
  });

  it("inserts the per-trade accrual row with correct shape", async () => {
    db._setFindResult(
      token,
      { address: "0xtoken1" },
      { address: "0xtoken1", creatorFeesUsd: 0n, protocolFeesUsd: 0n },
    );

    const handler = getHandler("FeeVault:FeeAccrued");
    const event = createMockEvent({
      args: {
        token: "0xtoken1",
        creator: "0xcreator",
        creatorAmount: 100_000n, // 0.1 USDC
        protocolAmount: 400_000n, // 0.4 USDC
        isBuy: true,
      },
      txHash: "0xtx1",
      logIndex: 2,
      blockNumber: 50n,
      blockTimestamp: 1700001000n,
    });

    await handler({ event, context: { db } });

    const accrualInsert = db._insertCalls.find((c) => c.table === feeAccrual);
    expect(accrualInsert).toBeDefined();
    expect(accrualInsert!.values).toEqual({
      id: "0xtx1-2",
      tokenAddress: "0xtoken1",
      creator: "0xcreator",
      creatorAmount: 100_000n,
      protocolAmount: 400_000n,
      isBuy: true,
      blockNumber: 50n,
      timestamp: 1700001000n,
    });
    expect(accrualInsert!.conflict).toBe("doNothing");
  });

  it("bumps creator + protocol lifetime counters on the token row", async () => {
    db._setFindResult(
      token,
      { address: "0xtoken1" },
      {
        address: "0xtoken1",
        creatorFeesUsd: 1_000_000n, // 1 USDC accrued so far
        protocolFeesUsd: 4_000_000n, // 4 USDC
      },
    );

    const handler = getHandler("FeeVault:FeeAccrued");
    const event = createMockEvent({
      args: {
        token: "0xtoken1",
        creator: "0xcreator",
        creatorAmount: 250_000n, // +0.25 USDC
        protocolAmount: 1_000_000n, // +1 USDC
        isBuy: false,
      },
    });

    await handler({ event, context: { db } });

    const tokenUpdate = db._updateCalls.find((c) => c.table === token);
    expect(tokenUpdate).toBeDefined();
    expect(tokenUpdate!.key).toEqual({ address: "0xtoken1" });
    expect(tokenUpdate!.values).toEqual({
      creatorFeesUsd: 1_250_000n,
      protocolFeesUsd: 5_000_000n,
    });
  });

  it("skips the counter bump when the token row is missing", async () => {
    // No `_setFindResult` — the handler must not crash if the accrual
    // arrives before the token has been indexed (shouldn't happen in
    // practice, but the handler is defensive).
    const handler = getHandler("FeeVault:FeeAccrued");
    const event = createMockEvent({
      args: {
        token: "0xunknown",
        creator: "0xcreator",
        creatorAmount: 100_000n,
        protocolAmount: 400_000n,
        isBuy: true,
      },
    });

    await handler({ event, context: { db } });

    expect(db._updateCalls.find((c) => c.table === token)).toBeUndefined();
    // The accrual row itself is still written — losing the per-token
    // attribution to a missing token row shouldn't drop the raw history.
    expect(db._insertCalls.find((c) => c.table === feeAccrual)).toBeDefined();
  });

  it("seeds creatorEarnings on the first accrual for a creator", async () => {
    db._setFindResult(
      token,
      { address: "0xtoken1" },
      { address: "0xtoken1", creatorFeesUsd: 0n, protocolFeesUsd: 0n },
    );

    const handler = getHandler("FeeVault:FeeAccrued");
    const event = createMockEvent({
      args: {
        token: "0xtoken1",
        creator: "0xcreator",
        creatorAmount: 250_000n,
        protocolAmount: 1_000_000n,
        isBuy: true,
      },
    });

    await handler({ event, context: { db } });

    const earningsInsert = db._insertCalls.find(
      (c) => c.table === creatorEarnings,
    );
    expect(earningsInsert).toBeDefined();
    expect(earningsInsert!.values).toEqual({
      creator: "0xcreator",
      lifetimeEarnedUsdc: 250_000n,
      lifetimeClaimedUsdc: 0n,
    });
    // Conflict fallback must be `doNothing`, not absolute-value `doUpdate` —
    // a `DoUpdate` here would clobber an already-accumulated row with this
    // single event's worth of earnings if the impossible race ever fired.
    expect(earningsInsert!.conflict).toBe("doNothing");
    // No update should run on the seeding path — the row was just inserted.
    expect(
      db._updateCalls.find((c) => c.table === creatorEarnings),
    ).toBeUndefined();
  });

  it("bumps existing creatorEarnings on subsequent accruals", async () => {
    db._setFindResult(
      token,
      { address: "0xtoken1" },
      { address: "0xtoken1", creatorFeesUsd: 0n, protocolFeesUsd: 0n },
    );
    db._setFindResult(
      creatorEarnings,
      { creator: "0xcreator" },
      {
        creator: "0xcreator",
        lifetimeEarnedUsdc: 1_000_000n, // 1 USDC accrued so far
        lifetimeClaimedUsdc: 0n,
      },
    );

    const handler = getHandler("FeeVault:FeeAccrued");
    const event = createMockEvent({
      args: {
        token: "0xtoken1",
        creator: "0xcreator",
        creatorAmount: 250_000n,
        protocolAmount: 0n,
        isBuy: false,
      },
    });

    await handler({ event, context: { db } });

    const earningsUpdate = db._updateCalls.find(
      (c) => c.table === creatorEarnings,
    );
    expect(earningsUpdate).toBeDefined();
    expect(earningsUpdate!.key).toEqual({ creator: "0xcreator" });
    expect(earningsUpdate!.values).toEqual({
      lifetimeEarnedUsdc: 1_250_000n,
    });
    // The claimed counter is left untouched on accrual — bumping it
    // would silently double-count claims when a `CreatorFeesClaimed`
    // arrives and applies its own delta.
    expect(
      (earningsUpdate!.values as Record<string, unknown>).lifetimeClaimedUsdc,
    ).toBeUndefined();
  });
});

describe("FeeVault:CreatorFeesClaimed", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
  });

  it("inserts a creator fee claim row", async () => {
    const handler = getHandler("FeeVault:CreatorFeesClaimed");
    const event = createMockEvent({
      args: {
        creator: "0xcreator1",
        amount: 7_500_000n, // 7.5 USDC
      },
      txHash: "0xclaim1",
      logIndex: 0,
      blockNumber: 200n,
      blockTimestamp: 1700100000n,
    });

    await handler({ event, context: { db } });

    const claimInsert = db._insertCalls.find((c) => c.table === feeClaim);
    expect(claimInsert).toBeDefined();
    expect(claimInsert!.values).toEqual({
      id: "0xclaim1-0",
      claimer: "0xcreator1",
      amount: 7_500_000n,
      isCreator: true,
      blockNumber: 200n,
      timestamp: 1700100000n,
    });
    expect(claimInsert!.conflict).toBe("doNothing");
  });

  it("bumps lifetimeClaimedUsdc when the creatorEarnings row exists", async () => {
    db._setFindResult(
      creatorEarnings,
      { creator: "0xcreator1" },
      {
        creator: "0xcreator1",
        lifetimeEarnedUsdc: 10_000_000n,
        lifetimeClaimedUsdc: 2_500_000n,
      },
    );

    const handler = getHandler("FeeVault:CreatorFeesClaimed");
    const event = createMockEvent({
      args: { creator: "0xcreator1", amount: 7_500_000n },
    });

    await handler({ event, context: { db } });

    const earningsUpdate = db._updateCalls.find(
      (c) => c.table === creatorEarnings,
    );
    expect(earningsUpdate).toBeDefined();
    expect(earningsUpdate!.key).toEqual({ creator: "0xcreator1" });
    expect(earningsUpdate!.values).toEqual({
      lifetimeClaimedUsdc: 10_000_000n,
    });
  });

  it("seeds creatorEarnings when a claim arrives before any accrual is indexed", async () => {
    // No `_setFindResult` for `creatorEarnings` — handler must seed.
    const handler = getHandler("FeeVault:CreatorFeesClaimed");
    const event = createMockEvent({
      args: { creator: "0xcreator2", amount: 1_000_000n },
    });

    await handler({ event, context: { db } });

    const earningsInsert = db._insertCalls.find(
      (c) => c.table === creatorEarnings,
    );
    expect(earningsInsert).toBeDefined();
    expect(earningsInsert!.values).toEqual({
      creator: "0xcreator2",
      lifetimeEarnedUsdc: 0n,
      lifetimeClaimedUsdc: 1_000_000n,
    });
    // See accumulator-upsert lock-in on the FeeAccrued seed test.
    expect(earningsInsert!.conflict).toBe("doNothing");
  });
});

describe("FeeVault:ProtocolFeesClaimed", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
  });

  it("inserts a protocol fee claim row with isCreator=false", async () => {
    const handler = getHandler("FeeVault:ProtocolFeesClaimed");
    const event = createMockEvent({
      args: {
        feeTo: "0xtreasury",
        amount: 50_000_000n, // 50 USDC
      },
    });

    await handler({ event, context: { db } });

    expect(db._insertCalls).toHaveLength(1);
    const claimInsert = db._insertCalls[0];
    expect(claimInsert.table).toBe(feeClaim);
    const values = claimInsert.values as Record<string, unknown>;
    expect(values.claimer).toBe("0xtreasury");
    expect(values.amount).toBe(50_000_000n);
    expect(values.isCreator).toBe(false);
  });
});
