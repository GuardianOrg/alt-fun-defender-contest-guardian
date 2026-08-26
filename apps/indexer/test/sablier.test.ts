import { describe, it, expect, beforeEach } from "vitest";
import { getAbiItem, toEventSelector } from "viem";
import { SablierLockupAbi } from "@launchpad/shared";
import { getHandler } from "./mocks/ponder";
import { createMockDb, createMockEvent } from "./mocks/db";
import { token, tokenLock } from "../ponder.schema";

await import("../src/sablier");

const LOCKUP = "0x5369e34c92eacc1cceaffe1be01f057c68ca1b19";
const TOKEN = "0xtoken1";
const DEPOSIT = 750_000_000n * 10n ** 18n;

/** The real 92-day timelock observed on mainnet, minus the parts we ignore. */
function timelockEvent(overrides: {
  cliffTime?: number;
  unlockStart?: bigint;
  unlockCliff?: bigint;
  cancelable?: boolean;
  tokenAddress?: string;
  depositAmount?: bigint;
} = {}) {
  const depositAmount = overrides.depositAmount ?? DEPOSIT;
  return createMockEvent({
    args: {
      streamId: 29n,
      commonParams: {
        funder: "0xbatch",
        sender: "0xcreator",
        recipient: "0xcreator",
        depositAmount,
        token: overrides.tokenAddress ?? TOKEN,
        cancelable: overrides.cancelable ?? false,
        transferable: false,
        timestamps: { start: 1787671521, end: 1795623922 },
        shape: "linearTimelock",
      },
      cliffTime: overrides.cliffTime ?? 1795623921,
      granularity: 1,
      unlockAmounts: {
        start: overrides.unlockStart ?? 0n,
        cliff: overrides.unlockCliff ?? depositAmount,
      },
    },
    logAddress: LOCKUP,
    blockNumber: 44_138_942n,
    blockTimestamp: 1787671521n,
  });
}

describe("SablierLockup ABI", () => {
  /**
   * The load-bearing assertion for this whole feature. `SablierLockupAbi` is
   * hand-vendored rather than generated, and Ponder derives its log filter
   * from the parameter list — so a single drift produces the wrong topic0,
   * the filter matches nothing, and `token_lock` stays silently empty with no
   * error surfaced anywhere (the issue-#418 failure mode).
   *
   * The expected hash is copied from a real `CreateLockupLinearStream` log on
   * HyperEVM (tx
   * 0x90ed4b245c2649f2c840847deb74250fa0034d18b54006f0bd1a4624b4a9411d), so
   * this pins the ABI against the deployed contract rather than against
   * itself.
   */
  it("derives the topic0 observed on-chain", () => {
    const event = getAbiItem({
      abi: SablierLockupAbi,
      name: "CreateLockupLinearStream",
    });
    expect(toEventSelector(event)).toBe(
      "0xbc42cec3f2bd75ce97894dacc83ec6c4b682220d349b5a52d5743e7b46eba2d0",
    );
  });
});

describe("SablierLockup:CreateLockupLinearStream", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
    db._setFindResult(token, { address: TOKEN }, { address: TOKEN });
  });

  it("records a non-cancelable pure timelock on one of our tokens", async () => {
    const handler = getHandler("SablierLockup:CreateLockupLinearStream");
    await handler({ event: timelockEvent(), context: { db } });

    const insert = db._insertCalls.find((c) => c.table === tokenLock);
    expect(insert).toBeDefined();
    expect(insert!.values).toEqual({
      id: `${LOCKUP}-29`,
      tokenAddress: TOKEN,
      lockup: LOCKUP,
      streamId: 29n,
      depositAmount: DEPOSIT,
      cliffTime: 1795623921n,
      blockNumber: 44_138_942n,
      timestamp: 1787671521n,
    });
    expect(insert!.conflict).toBe("doNothing");
  });

  it("ignores a stream on a token we did not launch without touching the DB", async () => {
    const handler = getHandler("SablierLockup:CreateLockupLinearStream");
    await handler({
      event: timelockEvent({ tokenAddress: "0xsomeoneelse" }),
      context: { db },
    });

    expect(db._insertCalls).toHaveLength(0);
  });

  it("rejects a cancelable stream before it costs a DB round-trip", async () => {
    // `cancel()` refunds the unvested balance to the sender, so a cancelable
    // stream is not a lock. Rejecting it ahead of the `token` lookup is also
    // what keeps foreign-project streams free.
    const handler = getHandler("SablierLockup:CreateLockupLinearStream");
    await handler({ event: timelockEvent({ cancelable: true }), context: { db } });

    expect(db._insertCalls).toHaveLength(0);
    expect(db.find).not.toHaveBeenCalled();
  });

  it("rejects a stream with no cliff, which would vest instantly", async () => {
    // `unlockAmounts.cliff === deposit` with `cliffTime === 0` hits Sablier's
    // `unlockAmountsSum >= depositedAmount` short-circuit on the first read,
    // so the whole deposit is withdrawable immediately.
    const handler = getHandler("SablierLockup:CreateLockupLinearStream");
    await handler({ event: timelockEvent({ cliffTime: 0 }), context: { db } });

    expect(db._insertCalls).toHaveLength(0);
    expect(db.find).not.toHaveBeenCalled();
  });

  it("rejects a stream that releases tokens at start", async () => {
    const handler = getHandler("SablierLockup:CreateLockupLinearStream");
    await handler({
      event: timelockEvent({
        unlockStart: 1n,
        unlockCliff: DEPOSIT - 1n,
      }),
      context: { db },
    });

    expect(db._insertCalls).toHaveLength(0);
  });

  it("rejects a vesting schedule that only unlocks part of the deposit at the cliff", async () => {
    // A linear tail after the cliff means the tokens unlock continuously,
    // which is not what a "locked" badge claims. Deliberately uncounted.
    const handler = getHandler("SablierLockup:CreateLockupLinearStream");
    await handler({
      event: timelockEvent({ unlockCliff: DEPOSIT / 2n }),
      context: { db },
    });

    expect(db._insertCalls).toHaveLength(0);
  });
});
