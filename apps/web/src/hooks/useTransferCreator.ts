import { useState, useCallback } from "react";

import { createPublicClient, http, isAddress } from "viem";

import { usePrivyWalletClient } from "./usePrivyWalletClient";
import { useWallet } from "./useWallet";
import { hyperEVM } from "../config/chains";
import { BondingAbi } from "../contracts/abis";
import { ADDRESSES } from "../contracts/addresses";

const rpcUrl = import.meta.env.VITE_RPC_URL || "https://rpc.hyperliquid.xyz/evm";
const hyperEvmClient = createPublicClient({
  chain: hyperEVM,
  transport: http(rpcUrl, { batch: true }),
});

/**
 * Validate the new-creator address before we even consider opening a wallet
 * popup. Mirrors the on-chain checks in `Bonding.transferCreator`:
 *   - must be a syntactically valid 20-byte hex address (`isAddress`)
 *   - must not be the zero address (`Bonding.ZeroAddress`)
 *   - must not equal the current creator (`Bonding.InvalidInput`)
 *
 * Returning a single discriminated union keeps the consumer's branching
 * surface tiny — it either renders the form-level error or proceeds to
 * the tx. We deliberately re-check on chain too (a stale `currentCreator`
 * snapshot from this client can race a concurrent transfer), but the
 * pre-flight catches the common typo cases before the wallet prompt.
 */
export type TransferValidation =
  | { ok: true; address: `0x${string}` }
  | { ok: false; reason: string };

export function validateNewCreator(
  raw: string,
  currentCreator: string | undefined,
): TransferValidation {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: "Enter a wallet address" };
  }
  // `strict: false` accepts both lowercase and EIP-55-checksummed input.
  // Wallets export addresses in either format and a creator pasting their
  // own address from MetaMask shouldn't be rejected for a checksum casing
  // mismatch — the contract treats addresses byte-equally regardless.
  if (!isAddress(trimmed, { strict: false })) {
    return { ok: false, reason: "Not a valid 0x address" };
  }
  if (/^0x0+$/i.test(trimmed)) {
    return { ok: false, reason: "Cannot transfer to the zero address" };
  }
  if (
    currentCreator &&
    trimmed.toLowerCase() === currentCreator.toLowerCase()
  ) {
    return { ok: false, reason: "Already the current creator" };
  }
  return { ok: true, address: trimmed as `0x${string}` };
}

export function useTransferCreator() {
  const { address, isConnected } = useWallet();
  const walletClient = usePrivyWalletClient();
  const [pendingToken, setPendingToken] = useState<string | null>(null);

  const transfer = useCallback(
    async (
      tokenAddress: `0x${string}`,
      newCreator: `0x${string}`,
    ): Promise<{ txHash: `0x${string}` }> => {
      if (!isConnected || !address || !walletClient) {
        throw new Error("Connect wallet first");
      }
      setPendingToken(tokenAddress);
      try {
        const hash = await walletClient.writeContract({
          address: ADDRESSES.bonding,
          abi: BondingAbi,
          functionName: "transferCreator",
          args: [tokenAddress, newCreator],
        });
        const receipt = await hyperEvmClient.waitForTransactionReceipt({
          hash,
        });
        if (receipt.status === "reverted") {
          throw new Error("Transfer transaction reverted on-chain");
        }
        return { txHash: hash };
      } finally {
        setPendingToken(null);
      }
    },
    [address, isConnected, walletClient],
  );

  return {
    transfer,
    pendingToken,
  };
}
