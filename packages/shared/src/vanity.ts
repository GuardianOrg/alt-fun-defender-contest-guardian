import {
  encodeAbiParameters,
  encodePacked,
  getAddress,
  keccak256,
  stringToHex,
  type Address,
  type Hex,
} from "viem";

/**
 * Lowercase-hex literal the frontend miner targets at the end of the
 * predicted address. Production value: `"00000"` (5 zeros) — every
 * launched token's address renders as `0x…00000`.
 *
 * Per-attempt probability: 1 / 16^suffixLen. With 5 zeros that's
 * ~1 / 1,048,576 → mean ≈ 1 M attempts (sub-second background mining on
 * typical hardware via the JS worker pool).
 *
 * Why digits, not letters: hex digits 0-9 render identically regardless
 * of EIP-55 checksum casing, so the launch invariant collapses to a
 * single bitwise mask check on-chain (`Bonding._checkVanity`) instead of
 * the keccak-over-lowercase-hex EIP-55 dance that letter suffixes
 * require. ~3 gas per launch vs ~15k.
 *
 * If you change the length here, keep the on-chain sources of truth in
 * sync: `Bonding.VANITY_TRAILING_ZEROS` (and the derived `_VANITY_MASK`
 * used by `Bonding._checkVanity`) plus `VanityMining.TRAILING_ZEROS`
 * (whose mask is derived in Yul). Diverging any of those bricks token
 * creation.
 */
export const VANITY_SUFFIX = "00000";

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
 * `keccak256` of the UTF-8 bytes of `s` — matches Solidity's
 * `keccak256(bytes(s))`. Used to pre-hash `name` / `ticker` for `mixSalt`
 * so the on-chain mix and the mining hot loop only ever move fixed-size
 * 32-byte words.
 */
export function metadataHash(s: string): Hex {
  return keccak256(stringToHex(s));
}

/**
 * Mix the user-supplied vanity salt with the creator address and the launch
 * metadata — must match `Bonding._mixSalt` byte-for-byte:
 *
 *   keccak256(abi.encode(
 *     creator,
 *     keccak256(bytes(name)),
 *     keccak256(bytes(ticker)),
 *     userSalt,
 *   ))
 *
 * Why mix the metadata in: a salt mined for one `(name, ticker)` pair will
 * not validate against a launch carrying any other pair. Editing the symbol
 * or name on the create form after a salt has been mined invalidates that
 * salt and forces a re-mine, so a creator can't slip new metadata into
 * a launch that was originally vetted under a different identity.
 *
 * Why mix the creator: a raw `userSalt` mined off-chain could be observed in
 * the mempool and front-run by another launcher who'd then own that vanity
 * address. Pinning the mix to `msg.sender` makes that impossible — Bob's tx
 * with Alice's mined salt deploys to a totally different address.
 */
export function mixSalt(
  creator: Address,
  name: string,
  ticker: string,
  userSalt: Hex,
): Hex {
  // `getAddress` checksums (and validates) the input. We always normalise
  // before passing to viem's encoder because workers/UI code may pass raw
  // lowercase strings, and viem rejects mixed-case non-checksummed values.
  return keccak256(
    encodeAbiParameters(
      [
        { type: "address" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
      ],
      [getAddress(creator), metadataHash(name), metadataHash(ticker), userSalt],
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
 * High-level helper mirroring
 * `Bonding.predictTokenAddress(creator, name, ticker, userSalt)`.
 *
 * Use this in UI code; the worker uses the lower-level `predictCloneAddress`
 * with a pre-computed `mixSalt` so it can hot-loop the random part only.
 */
export function predictTokenAddress(
  implementation: Address,
  bondingProxy: Address,
  creator: Address,
  name: string,
  ticker: string,
  userSalt: Hex,
): Address {
  return predictCloneAddress(
    implementation,
    mixSalt(creator, name, ticker, userSalt),
    bondingProxy,
  );
}

/**
 * Check whether an address satisfies the launch-time vanity invariant
 * (`Bonding._checkVanity`): the trailing `suffix.length` hex chars of the
 * address value must equal `suffix`. Comparison is case-insensitive so
 * caller-supplied addresses can be in any casing — production suffix is
 * all digits anyway, so casing doesn't matter, but this stays robust if
 * you ever bump to a letter suffix.
 *
 * Mostly used in tests + for assertions; the contract enforces this on
 * every launched token, so app code doesn't normally need to verify it.
 */
export function hasVanitySuffix(
  address: Address,
  suffix: string = VANITY_SUFFIX,
): boolean {
  return address.toLowerCase().endsWith(suffix.toLowerCase());
}
