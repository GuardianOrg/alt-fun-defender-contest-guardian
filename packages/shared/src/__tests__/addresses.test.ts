import { describe, it, expect } from "vitest";

import { CONTRACT_ADDRESSES, HYPERSWAP_ADDRESSES } from "../constants/addresses.js";

const CHECKSUMMED_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * Addresses intentionally left zero until the matching contract
 * deploys. `botFeeRouter` is operated by the Telegram-bot team and
 * lands later than the core protocol — the indexer registers its
 * subscription unconditionally and silently no-ops while the address
 * stays zero (see `apps/indexer/ponder.config.ts`). Replace this list
 * if you ever flip one of these to a deployed address.
 */
const ALLOWED_ZERO_KEYS = new Set(["botFeeRouter"]);

describe("CONTRACT_ADDRESSES", () => {
  it.each(Object.entries(CONTRACT_ADDRESSES))("%s is a valid checksummed address", (_key, addr) => {
    expect(addr).toMatch(CHECKSUMMED_ADDRESS_RE);
  });

  it.each(
    Object.entries(CONTRACT_ADDRESSES).filter(([key]) => !ALLOWED_ZERO_KEYS.has(key)),
  )("%s is not the zero address", (_key, addr) => {
    expect(addr).not.toBe(ZERO_ADDRESS);
  });

  it("contains expected contract keys", () => {
    expect(Object.keys(CONTRACT_ADDRESSES)).toEqual(
      expect.arrayContaining(["bonding", "factory", "router", "zap", "lpLock"]),
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
