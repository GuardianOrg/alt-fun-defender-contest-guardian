import { describe, expect, it } from "vitest";
import {
  encodeAbiParameters,
  getAddress,
  getContractAddress,
  keccak256,
  type Address,
  type Hex,
} from "viem";

import {
  eip1167InitCodeHash,
  hasVanitySuffix,
  mixSalt,
  predictCloneAddress,
  predictTokenAddress,
  VANITY_SUFFIX,
} from "../vanity.js";

const IMPL: Address = getAddress(
  "0x000000000000000000000000000000000000dead",
);
const BONDING: Address = getAddress(
  "0x00000000000000000000000000000000000000be",
);
const CREATOR: Address = getAddress(
  "0x000000000000000000000000000000000000c0de",
);
const USER: Address = getAddress(
  "0x000000000000000000000000000000000000b0b0",
);

describe("vanity", () => {
  it("eip1167InitCodeHash is stable for a given impl", () => {
    const a = eip1167InitCodeHash(IMPL);
    const b = eip1167InitCodeHash(IMPL);
    expect(a).toBe(b);
    expect(a).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("eip1167InitCodeHash differs across implementations", () => {
    expect(eip1167InitCodeHash(IMPL)).not.toBe(eip1167InitCodeHash(BONDING));
  });

  it("mixSalt matches keccak256(abi.encode(creator, userSalt)) — Bonding._mixSalt", () => {
    const userSalt: Hex =
      "0x1111111111111111111111111111111111111111111111111111111111111111";
    const expected = keccak256(
      encodeAbiParameters(
        [{ type: "address" }, { type: "bytes32" }],
        [CREATOR, userSalt],
      ),
    );
    expect(mixSalt(CREATOR, userSalt)).toBe(expected);
  });

  it("predictCloneAddress matches viem getContractAddress(create2)", () => {
    // viem's getContractAddress(create2) is the canonical CREATE2 derivation;
    // if our hand-rolled keccak chain ever drifts, this fails loudly.
    const userSalt: Hex =
      "0xabababababababababababababababababababababababababababababababab";
    const mixed = mixSalt(CREATOR, userSalt);
    const initCodeHash = eip1167InitCodeHash(IMPL);

    const ours = predictCloneAddress(IMPL, mixed, BONDING);
    const viemAddr = getContractAddress({
      bytecodeHash: initCodeHash,
      from: BONDING,
      opcode: "CREATE2",
      salt: mixed,
    });

    expect(ours).toBe(viemAddr);
  });

  it("different creators using same userSalt produce different addresses", () => {
    const userSalt: Hex =
      "0x2222222222222222222222222222222222222222222222222222222222222222";
    const a = predictTokenAddress(IMPL, BONDING, CREATOR, userSalt);
    const b = predictTokenAddress(IMPL, BONDING, USER, userSalt);
    expect(a).not.toBe(b);
  });

  it("different userSalts under same creator produce different addresses", () => {
    const a = predictTokenAddress(
      IMPL,
      BONDING,
      CREATOR,
      "0x1111111111111111111111111111111111111111111111111111111111111111",
    );
    const b = predictTokenAddress(
      IMPL,
      BONDING,
      CREATOR,
      "0x2222222222222222222222222222222222222222222222222222222222222222",
    );
    expect(a).not.toBe(b);
  });

  it("eip1167InitCodeHash matches OZ Clones v5 (golden value)", () => {
    // Hardcoded golden hash for `implementation = 0x...dead`. Computed from
    // OZ v5's `Clones.cloneDeterministic` init code:
    //   <prefix 20b>3d602d80600a3d3981f3363d3d373d3d3d363d73
    //   <impl 20b>00000000000000000000000000000000000000ad
    //   <suffix 15b>5af43d82803e903d91602b57fd5bf3
    // If this fails after a vanity.ts edit, the on-chain JS↔Solidity
    // address derivation has drifted and the worker would mine garbage
    // salts that revert with `NotVanityAddress`.
    const got = eip1167InitCodeHash(IMPL);
    const expectedInitCode = ("0x"
      + "3d602d80600a3d3981f3363d3d373d3d3d363d73"
      + IMPL.slice(2).toLowerCase()
      + "5af43d82803e903d91602b57fd5bf3") as Hex;
    expect(got).toBe(keccak256(expectedInitCode));
  });

  it("VANITY_SUFFIX is 4 hex chars", () => {
    expect(VANITY_SUFFIX).toMatch(/^[0-9a-f]{4}$/);
  });

  it("hasVanitySuffix is case-insensitive", () => {
    expect(hasVanitySuffix("0x000000000000000000000000000000000000A1FA")).toBe(
      true,
    );
    expect(hasVanitySuffix("0x000000000000000000000000000000000000a1fa")).toBe(
      true,
    );
    expect(hasVanitySuffix("0x000000000000000000000000000000000000abcd")).toBe(
      false,
    );
  });
});
