/**
 * Replay an on-chain revert against pre-tx state to recover the decoded
 * revert reason.
 *
 * Why this exists
 * ---------------
 * `publicClient.waitForTransactionReceipt` tells us whether a tx
 * succeeded or reverted but doesn't carry the revert reason — the
 * receipt is just `status: 0x0` for a revert. To learn what actually
 * went wrong (e.g. `TokenIsGraduating()` vs `BelowMinAmount()` vs an
 * inner `ERC20InsufficientAllowance(...)`), we replay the same call
 * via `eth_call` at the block just before the tx executed and decode
 * the resulting revert data against the ABI we had on hand.
 *
 * Without this every on-chain revert surfaced as a flat
 * "Zap.buy reverted on-chain (tx 0x...)" string in the iteration
 * line — useful for grep but not for understanding why. With this, an
 * iteration that crossed the graduation threshold mid-flight reads
 * "Zap.buy reverted on-chain: TokenIsGraduating() (tx 0x...)", which
 * is the actual signal you want during a stress run.
 *
 * Limitations
 * -----------
 *   - We simulate at `block - 1`, i.e. the end of the block BEFORE
 *     the reverting tx. That captures any reason that was already
 *     settled before the block. Intra-block races (another tx in the
 *     same block flipped state before ours executed) won't reproduce
 *     — those surface as a `race (...)` fallback so the operator
 *     knows the on-chain failure was state-dependent.
 *   - The error name is only decoded when the matching `error Foo()`
 *     declaration is in the ABI we pass. Errors that originate from
 *     inner contracts (e.g. `ERC20InsufficientAllowance` raised by a
 *     Token call inside `Zap.sell`) surface as a raw selector when
 *     the outer ABI doesn't redeclare them — still useful, just less
 *     human-friendly.
 */

import {
  BaseError,
  ContractFunctionRevertedError,
  type Abi,
  type Address,
  type Hex,
} from "viem";

import { errMessage } from "./logger.ts";

import type { PublicClient } from "./clients.ts";

export interface CallTarget {
  address: Address;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
}

export async function explainOnChainRevert(
  publicClient: PublicClient,
  txHash: Hex,
  target: CallTarget,
  caller: Address,
): Promise<string> {
  let blockNumber: bigint;
  try {
    const receipt = await publicClient.getTransactionReceipt({ hash: txHash });
    blockNumber = receipt.blockNumber;
  } catch (err) {
    return `unable to fetch receipt (${errMessage(err)})`;
  }

  try {
    await publicClient.simulateContract({
      address: target.address,
      abi: target.abi,
      functionName: target.functionName,
      args: target.args,
      account: caller,
      blockNumber: blockNumber - 1n,
    });
    // Pre-tx-block simulation succeeded — the revert was triggered by
    // a state change inside the same block as our tx (another trade
    // moved the curve, an LT rate ticked, a graduation phase flipped
    // mid-block, etc.). That's real signal worth surfacing as-is.
    return "race (simulation against pre-tx block succeeded)";
  } catch (err) {
    if (err instanceof BaseError) {
      const reverted = err.walk(
        (e): e is ContractFunctionRevertedError =>
          e instanceof ContractFunctionRevertedError,
      ) as ContractFunctionRevertedError | undefined;
      if (reverted) {
        if (reverted.data?.errorName) {
          return `${reverted.data.errorName}()`;
        }
        if (reverted.signature) return reverted.signature;
      }
    }
    if (err instanceof Error) {
      return err.message.split("\n")[0]!.trim();
    }
    return String(err);
  }
}
