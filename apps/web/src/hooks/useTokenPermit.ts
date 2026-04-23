import { useCallback } from "react";

import { domainSeparator, parseSignature, type PublicClient, type WalletClient } from "viem";

import { hyperEVM } from "../config/chains";
import { erc20Abi } from "../contracts/abis";
import { ADDRESSES } from "../contracts/addresses";

/// Shape matching the `LaunchpadRouter.PermitData` struct on-chain.
export interface PermitData {
  value: bigint;
  deadline: bigint;
  v: number;
  r: `0x${string}`;
  s: `0x${string}`;
}

interface SignPermitArgs {
  token: `0x${string}`;
  owner: `0x${string}`;
  spender: `0x${string}`;
  value: bigint;
  deadline: bigint;
  publicClient: PublicClient;
  walletClient: WalletClient;
}

/// USDC on HyperEVM is a `FiatTokenV2_2` — its EIP-712 domain uses
/// `version: "2"`. OZ's `ERC20Permit` (used by every FERC20 token this
/// protocol launches) hardcodes `version: "1"`. We pick the right one per
/// token. If USDC is ever re-implemented we fall back to `"1"` and rely on
/// the `DOMAIN_SEPARATOR` sanity check below to catch drift.
function permitVersionFor(token: `0x${string}`): string {
  return token.toLowerCase() === ADDRESSES.usdc.toLowerCase() ? "2" : "1";
}

/// Build the EIP-712 typed data for an ERC-2612 `Permit`. Matches the
/// `PERMIT_TYPEHASH` used by both FiatTokenV2_2 (USDC) and OpenZeppelin's
/// `ERC20Permit` (our FERC20s).
function buildPermitTypedData(args: {
  name: string;
  version: string;
  verifyingContract: `0x${string}`;
  owner: `0x${string}`;
  spender: `0x${string}`;
  value: bigint;
  nonce: bigint;
  deadline: bigint;
}) {
  return {
    domain: {
      name: args.name,
      version: args.version,
      chainId: hyperEVM.id,
      verifyingContract: args.verifyingContract,
    },
    types: {
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    } as const,
    primaryType: "Permit" as const,
    message: {
      owner: args.owner,
      spender: args.spender,
      value: args.value,
      nonce: args.nonce,
      deadline: args.deadline,
    },
  };
}

/// @notice Sign an EIP-2612 permit for any ERC20 that supports it.
/// @dev Reads `name` and `nonces(owner)` on-chain. For USDC we hardcode
///      version "2" (FiatTokenV2_2); for everything else we assume OZ's
///      default of "1". We also cross-check against the on-chain
///      `DOMAIN_SEPARATOR()` and throw if it doesn't match — catches the
///      case where an unexpected token slipped past.
export function useTokenPermit() {
  const signPermit = useCallback(async (args: SignPermitArgs): Promise<PermitData> => {
    const { token, owner, spender, value, deadline, publicClient, walletClient } = args;

    const [name, nonce, onChainDomainSep] = await Promise.all([
      publicClient.readContract({ address: token, abi: erc20Abi, functionName: "name" }),
      publicClient.readContract({
        address: token,
        abi: erc20Abi,
        functionName: "nonces",
        args: [owner],
      }),
      publicClient.readContract({
        address: token,
        abi: erc20Abi,
        functionName: "DOMAIN_SEPARATOR",
      }),
    ]);

    const version = permitVersionFor(token);

    const typedData = buildPermitTypedData({
      name: name as string,
      version,
      verifyingContract: token,
      owner,
      spender,
      value,
      nonce: nonce as bigint,
      deadline,
    });

    // Sanity check: the typed-data domain we're about to sign must hash to
    // exactly what the token reports on-chain. If it doesn't, the permit
    // tx would revert on `ecrecover` — we throw here with a clear message
    // instead, so the caller can fall back to the legacy approve flow.
    const computedDomainSep = domainSeparator({ domain: typedData.domain });
    if (computedDomainSep.toLowerCase() !== (onChainDomainSep as string).toLowerCase()) {
      throw new Error(
        `EIP-712 domain mismatch for ${token}: expected ${onChainDomainSep} but computed ${computedDomainSep}`,
      );
    }

    const signature = await walletClient.signTypedData({
      account: owner,
      ...typedData,
    });

    const { r, s, v, yParity } = parseSignature(signature);
    const recovery = v !== undefined ? Number(v) : yParity !== undefined ? yParity + 27 : undefined;
    if (recovery === undefined) {
      throw new Error("Permit signature missing recovery parameter");
    }
    return { value, deadline, v: recovery, r, s };
  }, []);

  return { signPermit };
}
