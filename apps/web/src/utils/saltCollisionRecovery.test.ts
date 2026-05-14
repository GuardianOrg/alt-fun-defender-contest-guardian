import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_MAX_SALT_COLLISION_RETRIES,
  resolveLaunchSalt,
  saltCollisionExhaustedMessage,
  SALT_COLLISION_NO_RECOVERY_MESSAGE,
} from "./saltCollisionRecovery";

import type { Address, Hex } from "viem";

const SALT_A: Hex = `0x${"a".repeat(64)}`;
const SALT_B: Hex = `0x${"b".repeat(64)}`;
const SALT_C: Hex = `0x${"c".repeat(64)}`;
const SALT_D: Hex = `0x${"d".repeat(64)}`;

const ADDR_A: Address = "0x000000000000000000000000000000000000000A";
const ADDR_B: Address = "0x000000000000000000000000000000000000000B";
const ADDR_C: Address = "0x000000000000000000000000000000000000000C";
const ADDR_D: Address = "0x000000000000000000000000000000000000000D";

const EMPTY_CODE: Hex = "0x";
/// Realistic-shaped bytecode prefix for an OpenZeppelin minimal proxy.
/// The exact bytes are irrelevant — `resolveLaunchSalt` only checks
/// the empty / non-empty distinction — but a non-trivial value makes
/// the assertions read closer to a real `eth_getCode` response.
const OCCUPIED_CODE: Hex = "0x363d3d373d3d3d363d73beef";

describe("resolveLaunchSalt", () => {
  it("returns the initial salt unchanged when its predicted address is empty", async () => {
    const getBytecode = vi.fn(async () => EMPTY_CODE as Hex);
    const mineFreshSalt = vi.fn(async () => ({ salt: SALT_B, address: ADDR_B }));

    const result = await resolveLaunchSalt({
      initialSalt: SALT_A,
      initialPredicted: ADDR_A,
      getBytecode,
      mineFreshSalt,
    });

    expect(result).toEqual({ salt: SALT_A, address: ADDR_A, retries: 0 });
    expect(getBytecode).toHaveBeenCalledTimes(1);
    expect(getBytecode).toHaveBeenCalledWith(ADDR_A);
    // The miner must NOT be invoked when the initial slot is free —
    // doing so would force a fresh re-mine on every launch (the cached
    // salt is the whole point of the worker pool's localStorage layer)
    // AND drop the user's hard-won vanity tier on the floor.
    expect(mineFreshSalt).not.toHaveBeenCalled();
  });

  it("treats an undefined `getBytecode` result as an empty slot", async () => {
    // Some viem versions return `undefined` rather than `"0x"` for an
    // address with no code. The helper must accept both — otherwise
    // the very first launch on a fresh wallet (where `bestRef` /
    // localStorage is empty and the predicted address has obviously
    // never seen bytecode) would falsely trip the collision branch
    // and either invoke a nonexistent `mineFreshSalt` or burn through
    // the retry budget for no reason.
    const getBytecode = vi.fn(async () => undefined);
    const mineFreshSalt = vi.fn(async () => ({ salt: SALT_B, address: ADDR_B }));

    const result = await resolveLaunchSalt({
      initialSalt: SALT_A,
      initialPredicted: ADDR_A,
      getBytecode,
      mineFreshSalt,
    });

    expect(result).toEqual({ salt: SALT_A, address: ADDR_A, retries: 0 });
    expect(mineFreshSalt).not.toHaveBeenCalled();
  });

  it("re-mines on collision and returns the fresh pair on success", async () => {
    const codeByAddress: Record<Address, Hex> = {
      [ADDR_A]: OCCUPIED_CODE,
      [ADDR_B]: EMPTY_CODE,
      [ADDR_C]: EMPTY_CODE,
      [ADDR_D]: EMPTY_CODE,
    };
    const getBytecode = vi.fn(
      async (address: Address) => codeByAddress[address] ?? EMPTY_CODE,
    );
    const mineFreshSalt = vi.fn(async () => ({ salt: SALT_B, address: ADDR_B }));

    const result = await resolveLaunchSalt({
      initialSalt: SALT_A,
      initialPredicted: ADDR_A,
      getBytecode,
      mineFreshSalt,
    });

    expect(result).toEqual({ salt: SALT_B, address: ADDR_B, retries: 1 });
    // Initial check (collision) + post-retry check (free) = 2 lookups.
    // Anything else means we either skipped the recovery or kept
    // re-mining after finding a free slot.
    expect(getBytecode).toHaveBeenCalledTimes(2);
    expect(getBytecode).toHaveBeenNthCalledWith(1, ADDR_A);
    expect(getBytecode).toHaveBeenNthCalledWith(2, ADDR_B);
    expect(mineFreshSalt).toHaveBeenCalledTimes(1);
  });

  it("retries multiple times when successive re-mines also collide", async () => {
    // First two re-mined addresses are also occupied (improbable in
    // production but pinned here so the loop can't silently
    // short-circuit after a single retry — the budget exists for
    // exactly this kind of pathological fan-out and we need the test
    // to fail loudly if the loop body grows an early-return bug).
    const codeByAddress: Record<Address, Hex> = {
      [ADDR_A]: OCCUPIED_CODE,
      [ADDR_B]: OCCUPIED_CODE,
      [ADDR_C]: OCCUPIED_CODE,
      [ADDR_D]: EMPTY_CODE,
    };
    const getBytecode = vi.fn(
      async (address: Address) => codeByAddress[address] ?? EMPTY_CODE,
    );
    const minedQueue = [
      { salt: SALT_B, address: ADDR_B },
      { salt: SALT_C, address: ADDR_C },
      { salt: SALT_D, address: ADDR_D },
    ];
    const mineFreshSalt = vi.fn(async () => minedQueue.shift()!);

    const result = await resolveLaunchSalt({
      initialSalt: SALT_A,
      initialPredicted: ADDR_A,
      getBytecode,
      mineFreshSalt,
    });

    expect(result).toEqual({ salt: SALT_D, address: ADDR_D, retries: 3 });
    expect(mineFreshSalt).toHaveBeenCalledTimes(3);
    expect(getBytecode).toHaveBeenCalledTimes(4);
  });

  it("throws the manual-recovery message when no `mineFreshSalt` is provided", async () => {
    // Defensive: production callers always wire a recovery callback,
    // but the public API allows it to be omitted (e.g. for a future
    // preview / dry-run code path). When that happens a collision must
    // surface an actionable message rather than silently throwing some
    // internal "callback missing" error — pin both the type and the
    // user-facing copy so a future refactor can't drop either.
    const getBytecode = vi.fn(async () => OCCUPIED_CODE as Hex);

    await expect(
      resolveLaunchSalt({
        initialSalt: SALT_A,
        initialPredicted: ADDR_A,
        getBytecode,
        mineFreshSalt: undefined,
      }),
    ).rejects.toThrowError(SALT_COLLISION_NO_RECOVERY_MESSAGE);
    expect(getBytecode).toHaveBeenCalledTimes(1);
  });

  it("throws the exhaustion message after the retry budget runs out", async () => {
    // Pin the exhaustion behaviour with a tight `maxRetries: 2` so the
    // assertion is fast and unambiguous. With 2 retries we expect:
    //   - 3 pre-flight checks total (initial + 2 re-mined)
    //   - 2 mineFreshSalt invocations
    //   - The thrown message includes the total attempt count
    //     (`maxRetries + 1`), so a future bump of the default budget
    //     can't silently break the copy.
    const getBytecode = vi.fn(async () => OCCUPIED_CODE as Hex);
    const mineFreshSalt = vi.fn(async () => ({ salt: SALT_B, address: ADDR_B }));

    await expect(
      resolveLaunchSalt({
        initialSalt: SALT_A,
        initialPredicted: ADDR_A,
        getBytecode,
        mineFreshSalt,
        maxRetries: 2,
      }),
    ).rejects.toThrowError(saltCollisionExhaustedMessage(2));
    expect(getBytecode).toHaveBeenCalledTimes(3);
    expect(mineFreshSalt).toHaveBeenCalledTimes(2);
  });

  it("propagates errors thrown by `mineFreshSalt`", async () => {
    // Worker spawn failures (`Vanity address miner failed.`) and
    // mid-flight cancellations (`Vanity mining was cancelled.`) bubble
    // up through `ensureSalt`, which is what `mineFreshSalt` awaits.
    // The recovery loop must NOT swallow these — the caller's launch
    // surfaces the message in its error banner so the user understands
    // why the launch aborted.
    const getBytecode = vi.fn(async () => OCCUPIED_CODE as Hex);
    const mineFreshSalt = vi.fn(async () => {
      throw new Error("Vanity address miner failed. Please refresh and try again.");
    });

    await expect(
      resolveLaunchSalt({
        initialSalt: SALT_A,
        initialPredicted: ADDR_A,
        getBytecode,
        mineFreshSalt,
      }),
    ).rejects.toThrowError(/Vanity address miner failed/);
    expect(mineFreshSalt).toHaveBeenCalledTimes(1);
  });

  it("uses the documented default retry budget", async () => {
    // Make `getBytecode` permanently colliding so the loop must run
    // to exhaustion. With the default budget we expect
    // `DEFAULT_MAX_SALT_COLLISION_RETRIES` re-mine calls and one extra
    // pre-flight check on top of those. Pinning the constant here
    // means the default budget can't drift without an explicit test
    // update.
    const getBytecode = vi.fn(async () => OCCUPIED_CODE as Hex);
    const mineFreshSalt = vi.fn(async () => ({ salt: SALT_B, address: ADDR_B }));

    await expect(
      resolveLaunchSalt({
        initialSalt: SALT_A,
        initialPredicted: ADDR_A,
        getBytecode,
        mineFreshSalt,
      }),
    ).rejects.toThrowError(
      saltCollisionExhaustedMessage(DEFAULT_MAX_SALT_COLLISION_RETRIES),
    );
    expect(mineFreshSalt).toHaveBeenCalledTimes(
      DEFAULT_MAX_SALT_COLLISION_RETRIES,
    );
    expect(getBytecode).toHaveBeenCalledTimes(
      DEFAULT_MAX_SALT_COLLISION_RETRIES + 1,
    );
  });
});
