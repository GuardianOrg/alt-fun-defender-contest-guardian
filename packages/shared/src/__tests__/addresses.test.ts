import { describe, it, expect } from "vitest";

import { CONTRACT_ADDRESSES, HYPERSWAP_ADDRESSES } from "../constants/addresses.js";

const CHECKSUMMED_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

describe("CONTRACT_ADDRESSES", () => {
  it.each(Object.entries(CONTRACT_ADDRESSES))("%s is a valid checksummed address", (_key, addr) => {
    expect(addr).toMatch(CHECKSUMMED_ADDRESS_RE);
  });

  it.each(Object.entries(CONTRACT_ADDRESSES))("%s is not the zero address", (_key, addr) => {
    expect(addr).not.toBe("0x0000000000000000000000000000000000000000");
  });

  it("contains expected contract keys", () => {
    expect(Object.keys(CONTRACT_ADDRESSES)).toEqual(
      expect.arrayContaining(["bonding", "factory", "router", "redemptionRouter", "lpLock"]),
    );
  });
});

describe("HYPERSWAP_ADDRESSES", () => {
  it.each(Object.entries(HYPERSWAP_ADDRESSES))("%s is a valid checksummed address", (_key, addr) => {
    expect(addr).toMatch(CHECKSUMMED_ADDRESS_RE);
  });

  it.each(Object.entries(HYPERSWAP_ADDRESSES))("%s is not the zero address", (_key, addr) => {
    expect(addr).not.toBe("0x0000000000000000000000000000000000000000");
  });

  it("contains factory and router", () => {
    expect(Object.keys(HYPERSWAP_ADDRESSES)).toEqual(
      expect.arrayContaining(["factory", "router"]),
    );
  });
});
