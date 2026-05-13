/**
 * Hand-rolled nonce serialiser shared by every scenario that submits
 * transactions from the harness wallet.
 *
 * Why this exists (and why viem's auto-nonce can't replace it)
 * -----------------------------------------------------------
 * viem fetches the pending nonce on every `writeContract` if you don't
 * supply one. When two `writeContract` calls overlap in time — which is
 * the entire point of `--concurrency K > 1` — both reads return the
 * same "pending" nonce and the second submit reverts with a nonce
 * mismatch. Same pitfall the `apps/api` keepers ran into (see
 * `apps/api/src/lib/auto-graduation-buyer.ts`) and the same fix:
 * manage the nonce locally, hand each tx exactly one.
 *
 * Lock semantics
 * --------------
 * - `acquire()` returns the next free nonce and blocks the next caller
 *   until the current holder calls `commit()` or `rollback()`. That
 *   serialises ONLY the broadcast step — receipt waiting pipelines
 *   across workers freely.
 * - `commit()` releases the lock so the next caller can grab the
 *   next nonce. Called after `walletClient.writeContract` resolves
 *   (i.e. the tx is in the mempool, the nonce is consumed).
 * - `rollback()` releases the lock AND decrements the local counter,
 *   making the just-allocated slot available again. Called when the
 *   submit threw before reaching the mempool — failed pre-flights
 *   don't consume a nonce on-chain, so the local counter mustn't
 *   advance either.
 *
 * Every caller MUST pair an `acquire()` with exactly one of
 * `commit()` / `rollback()`. A missing release deadlocks every
 * subsequent acquire on the same manager.
 */

import type { Address } from "viem";

import { log } from "./logger.ts";

import type { PublicClient } from "./clients.ts";

export class NonceManager {
  private nonce: number;
  private chain: Promise<void> = Promise.resolve();
  private heldResolve: (() => void) | null = null;

  private constructor(initial: number) {
    this.nonce = initial;
  }

  static async create(
    publicClient: PublicClient,
    address: Address,
  ): Promise<NonceManager> {
    const initial = await publicClient.getTransactionCount({
      address,
      blockTag: "pending",
    });
    log("debug", "nonce_manager_init", { address, initial });
    return new NonceManager(initial);
  }

  async acquire(): Promise<number> {
    const waitFor = this.chain;
    // Capture this caller's resolver in a LOCAL — assigning to
    // `this.heldResolve` synchronously would let a queued caller
    // arriving before our `await waitFor` resolves clobber the
    // pointer, so when the current holder eventually `commit()`s it
    // calls the wrong resolver and our predecessor's waiters block
    // forever. Setting `this.heldResolve = release` AFTER the await
    // means each holder only writes the slot once it's actually
    // holding the lock. CodeRabbit caught this on PR #736; the
    // failure mode is silent deadlock under any concurrency > 1.
    let release!: () => void;
    this.chain = new Promise<void>((resolve) => {
      release = resolve;
    });
    await waitFor;
    this.heldResolve = release;
    return this.nonce++;
  }

  commit(): void {
    this.heldResolve?.();
    this.heldResolve = null;
  }

  rollback(): void {
    this.nonce--;
    this.heldResolve?.();
    this.heldResolve = null;
  }
}
