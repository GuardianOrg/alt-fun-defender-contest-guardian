import { describe, expect, it } from "vitest";
import {
  encodeAbiParameters,
  getAddress,
  getContractAddress,
  keccak256,
  stringToHex,
  type Address,
  type Hex,
} from "viem";

import {
  eip1167InitCodeHash,
  hasVanitySuffix,
  metadataHash,
  mixSalt,
  predictCloneAddress,
  predictTokenAddress,
  VANITY_SUFFIX,
} from "../vanity.js";

const NAME = "TestToken";
const TICKER = "TEST";

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

  it("metadataHash matches keccak256(bytes(s)) — Solidity helper", () => {
    expect(metadataHash(NAME)).toBe(keccak256(stringToHex(NAME)));
    expect(metadataHash("")).toBe(keccak256("0x"));
  });

  it("mixSalt matches keccak256(abi.encode(creator, nameHash, tickerHash, userSalt)) — Bonding._mixSalt", () => {
    const userSalt: Hex =
      "0x1111111111111111111111111111111111111111111111111111111111111111";
    const expected = keccak256(
      encodeAbiParameters(
        [
          { type: "address" },
          { type: "bytes32" },
          { type: "bytes32" },
          { type: "bytes32" },
        ],
        [CREATOR, metadataHash(NAME), metadataHash(TICKER), userSalt],
      ),
    );
    expect(mixSalt(CREATOR, NAME, TICKER, userSalt)).toBe(expected);
  });

  it("predictCloneAddress matches viem getContractAddress(create2)", () => {
    // viem's getContractAddress(create2) is the canonical CREATE2 derivation;
    // if our hand-rolled keccak chain ever drifts, this fails loudly.
    const userSalt: Hex =
      "0xabababababababababababababababababababababababababababababababab";
    const mixed = mixSalt(CREATOR, NAME, TICKER, userSalt);
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
    const a = predictTokenAddress(IMPL, BONDING, CREATOR, NAME, TICKER, userSalt);
    const b = predictTokenAddress(IMPL, BONDING, USER, NAME, TICKER, userSalt);
    expect(a).not.toBe(b);
  });

  it("different userSalts under same creator produce different addresses", () => {
    const a = predictTokenAddress(
      IMPL,
      BONDING,
      CREATOR,
      NAME,
      TICKER,
      "0x1111111111111111111111111111111111111111111111111111111111111111",
    );
    const b = predictTokenAddress(
      IMPL,
      BONDING,
      CREATOR,
      NAME,
      TICKER,
      "0x2222222222222222222222222222222222222222222222222222222222222222",
    );
    expect(a).not.toBe(b);
  });

  it("different (name, ticker) under same creator+salt produce different addresses", () => {
    // Headline guarantee for the on-chain salt binding: editing the symbol
    // or name on the create form invalidates a previously-mined salt and
    // forces a fresh mine. This mirrors Solidity's
    // `test_predictTokenAddress_differentNameOrTicker_differentAddresses`.
    const userSalt: Hex =
      "0x3333333333333333333333333333333333333333333333333333333333333333";
    const baseline = predictTokenAddress(
      IMPL,
      BONDING,
      CREATOR,
      "Foo",
      "FOO",
      userSalt,
    );
    const altName = predictTokenAddress(
      IMPL,
      BONDING,
      CREATOR,
      "Bar",
      "FOO",
      userSalt,
    );
    const altTicker = predictTokenAddress(
      IMPL,
      BONDING,
      CREATOR,
      "Foo",
      "BAR",
      userSalt,
    );
    expect(baseline).not.toBe(altName);
    expect(baseline).not.toBe(altTicker);
    expect(altName).not.toBe(altTicker);
  });

  it("eip1167InitCodeHash matches OZ Clones v5 (golden value)", () => {
    // Golden init-code layout for `IMPL = 0x000000000000000000000000000000000000dead`,
    // per OZ v5's `Clones.cloneDeterministic`:
    //   <prefix 20b> 3d602d80600a3d3981f3363d3d373d3d3d363d73
    //   <impl   20b> 000000000000000000000000000000000000dead
    //   <suffix 15b> 5af43d82803e903d91602b57fd5bf3
    // Keep the impl bytes here in lockstep with the `IMPL` constant above —
    // the test itself uses `IMPL.slice(2)` so it stays correct, but a stale
    // comment will mislead the next person trying to recompute by hand.
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

  it("VANITY_SUFFIX is 5 hex chars", () => {
    expect(VANITY_SUFFIX).toMatch(/^[0-9a-f]{5}$/);
  });

  it("hasVanitySuffix is case-insensitive on the trailing chars", () => {
    expect(hasVanitySuffix("0x00000000000000000000000000000000000000000")).toBe(
      true,
    );
    expect(hasVanitySuffix("0x123456789abcdef0123456789abcdef000000000")).toBe(
      true,
    );
    // Suffix doesn't match — last 5 chars are not all zero.
    expect(hasVanitySuffix("0x00000000000000000000000000000000000aaaaa")).toBe(
      false,
    );
    expect(hasVanitySuffix("0x000000000000000000000000000000000000abcd")).toBe(
      false,
    );
  });
});
