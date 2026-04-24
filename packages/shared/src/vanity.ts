import {
  encodeAbiParameters,
  encodePacked,
  getAddress,
  keccak256,
  type Address,
  type Hex,
} from "viem";

/**
 * Vanity-suffix length the frontend miner targets. 4 hex chars (16 bits) ≈
 * 65,536 attempts on average — typically <200 ms on a single worker, sub-50ms
 * with `navigator.hardwareConcurrency` workers in parallel. Sized for "feels
 * instant" UX: by the time the user has filled in the form, mining has
 * usually finished. Bump to 5 (~1 M attempts, 1-3 s) only if we want to
 * trade UX for prettier addresses.
 *
 * Lower-cased hex; the matcher compares against `address.slice(-4)` which is
 * also lower-case (viem checksum uppercases letters but the suffix check
 * runs on the raw `slice(-40)` of the keccak hash, never the checksum form).
 */
export const VANITY_SUFFIX = "a1fa";

/**
 * EIP-1167 minimal-proxy *creation* code, OpenZeppelin v5 layout.
 *
 *   <PREFIX (20b)> <impl-address (20b)> <SUFFIX (15b)> = 55-byte init code
 *
 * Note: the `runtime` deployed by this init code is still 45 bytes (the
 * EIP-1167 spec size); OZ v5 packs a marginally cheaper runtime via a
 * longer suffix (`5af43d82803e903d91602b57fd5bf3`) than the original
 * spec's `5af43d82803d3d82f3`. CREATE2 hashes the *creation* code, so it's
 * the longer suffix that matters for address derivation.
 *
 *   addr = keccak256(0xff ++ deployer ++ salt ++ keccak256(initCode))[12:]
 *
 * These constants must mirror `Clones.cloneDeterministic` byte-for-byte —
 * see `Clones.sol` lines around `0x5af43d82803e903d91602b57fd5bf3`. The
 * Foundry test `test_predictTokenAddress_matchesOZHelper` verifies the
 * contract side of this and `golden_eip1167InitCodeHash_matchesOZ` in
 * `vanity.test.ts` pins the JS side to a known-good value.
 */
const EIP1167_CREATION_PREFIX: Hex =
  "0x3d602d80600a3d3981f3363d3d373d3d3d363d73";
const EIP1167_CREATION_SUFFIX: Hex = "0x5af43d82803e903d91602b57fd5bf3";

/**
 * Compute keccak256(initCode) for the EIP-1167 proxy of `implementation`.
 * This value is constant per implementation address — the worker can cache
 * it once and re-use it for every salt attempt, which is the whole reason
 * client-side mining is cheap (only one keccak per attempt instead of two).
 */
export function eip1167InitCodeHash(implementation: Address): Hex {
  const impl = implementation.toLowerCase().slice(2).padStart(40, "0");
  const initCode =
    `${EIP1167_CREATION_PREFIX}${impl}${EIP1167_CREATION_SUFFIX.slice(2)}` as Hex;
  return keccak256(initCode);
}

/**
 * Mix the user-supplied vanity salt with the creator address — must match
 * `Bonding._mixSalt` byte-for-byte:
 *
 *   keccak256(abi.encode(creator, userSalt))
 *
 * Why mix at all: a raw `userSalt` mined off-chain could be observed in the
 * mempool and front-run by another launcher who'd then own that vanity
 * address. Pinning it to `msg.sender` makes that impossible — Bob's tx
 * with Alice's mined salt deploys to a totally different address.
 */
export function mixSalt(creator: Address, userSalt: Hex): Hex {
  // `getAddress` checksums (and validates) the input. We always normalise
  // before passing to viem's encoder because workers/UI code may pass raw
  // lowercase strings, and viem rejects mixed-case non-checksummed values.
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "bytes32" }],
      [getAddress(creator), userSalt],
    ),
  );
}

/**
 * Predict where `Clones.cloneDeterministic(implementation, mixedSalt)` would
 * deploy when called by `deployer`. Returns a checksummed address.
 *
 * `mixedSalt` MUST already be the output of `mixSalt(creator, userSalt)` —
 * this function is the low-level address derivation; the convenience
 * wrapper `predictTokenAddress` below takes the unmixed salt.
 */
export function predictCloneAddress(
  implementation: Address,
  mixedSalt: Hex,
  deployer: Address,
): Address {
  const initCodeHash = eip1167InitCodeHash(implementation);
  const packed = encodePacked(
    ["bytes1", "address", "bytes32", "bytes32"],
    ["0xff", getAddress(deployer), mixedSalt, initCodeHash],
  );
  const hash = keccak256(packed);
  return getAddress(`0x${hash.slice(-40)}`);
}

/**
 * High-level helper mirroring `Bonding.predictTokenAddress(creator, userSalt)`.
 * Use this in UI code; the worker uses the lower-level `predictCloneAddress`
 * with a pre-computed `mixSalt` so it can hot-loop the random part only.
 */
export function predictTokenAddress(
  implementation: Address,
  bondingProxy: Address,
  creator: Address,
  userSalt: Hex,
): Address {
  return predictCloneAddress(
    implementation,
    mixSalt(creator, userSalt),
    bondingProxy,
  );
}

/**
 * Check whether an address ends with the vanity suffix. Comparison is
 * case-insensitive to dodge checksum-casing surprises.
 *
 * Mostly used in tests + for assertions; the contract enforces the suffix
 * on every launched token (see `Bonding.NotVanityAddress`), so app code
 * doesn't need to verify it.
 */
export function hasVanitySuffix(
  address: Address,
  suffix: string = VANITY_SUFFIX,
): boolean {
  return address.toLowerCase().endsWith(suffix.toLowerCase());
}
