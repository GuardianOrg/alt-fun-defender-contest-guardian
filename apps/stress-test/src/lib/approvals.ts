/**
 * Generic ERC-20 allowance helper. Every harness scenario starts by
 * making sure the wallet has approved the contracts it'll spend
 * through — without it the first scenario tx reverts and we burn an
 * iteration finding out. Centralising lets each scenario express its
 * setup as a flat sequence of `await ensureAllowance(...)` calls.
 *
 * Strategy is permissive: if `allowance < required`, approve to
 * `maxUint256` so we never need to top up again across the run.
 * `MaxUint256` is fine for our hot-wallet model — the wallet only ever
 * holds disposable stress-test capital and the spender is one of our
 * own contracts (`Zap`). For a long-lived user wallet you'd want a
 * tighter cap, but that's not what this harness signs from.
 */

import { TokenAbi } from "@launchpad/shared";
import { maxUint256, type Address, type Hex } from "viem";

import type { PublicClient, WalletClient } from "./clients.ts";
import { errMessage, info, log, success } from "./logger.ts";
import type { NonceManager } from "./nonce-manager.ts";

export interface EnsureAllowanceParams {
  publicClient: PublicClient;
  walletClient: WalletClient;
  nonceManager: NonceManager;
  owner: Address;
  /** ERC-20 contract address. */
  token: Address;
  /** Whoever's spending — usually `CONTRACT_ADDRESSES.zap`. */
  spender: Address;
  /** Minimum allowance needed. Approve to maxUint256 if below this. */
  required: bigint;
  /** Human-readable name shown in section / status lines. */
  label: string;
}

export async function ensureAllowance({
  publicClient,
  walletClient,
  nonceManager,
  owner,
  token,
  spender,
  required,
  label,
}: EnsureAllowanceParams): Promise<void> {
  const allowance = (await publicClient.readContract({
    address: token,
    abi: TokenAbi,
    functionName: "allowance",
    args: [owner, spender],
  })) as bigint;

  if (allowance >= required) {
    success(`${label}: already approved`);
    log("debug", "allowance_sufficient", {
      token,
      spender,
      allowance: allowance.toString(),
    });
    return;
  }

  info(`${label}: approving (maxUint256) — one-time tx`);
  const nonce = await nonceManager.acquire();
  let hash: Hex;
  try {
    hash = await walletClient.writeContract({
      address: token,
      abi: TokenAbi,
      functionName: "approve",
      args: [spender, maxUint256],
      nonce,
    });
    nonceManager.commit();
  } catch (err) {
    nonceManager.rollback();
    throw new Error(`${label}: approve submit failed: ${errMessage(err)}`, {
      cause: err,
    });
  }
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status === "reverted") {
    throw new Error(`${label}: approve reverted on-chain (${hash})`);
  }
  success(`${label}: approved (${hash.slice(0, 10)}…)`);
  log("debug", "allowance_set", { token, spender, hash, nonce });
}
