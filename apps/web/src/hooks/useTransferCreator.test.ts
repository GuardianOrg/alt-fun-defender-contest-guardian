import { describe, expect, it } from "vitest";

import { validateNewCreator } from "./useTransferCreator";

const VALID_ADDRESS = "0x1234567890abcdef1234567890abcdef12345678";
const ANOTHER_VALID_ADDRESS = "0xabcdefABCDEF1234567890abcdef1234567890aB";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

describe("validateNewCreator", () => {
  // The form-level pre-flight maps 1:1 to the on-chain reverts in
  // `Bonding.transferCreator` — empty / malformed input never makes it
  // to the wallet popup, and the message is surfaced verbatim under
  // the input field. These tests pin every branch so a future copy
  // tweak can't silently delete a guard.
  it("rejects empty input", () => {
    const r = validateNewCreator("", VALID_ADDRESS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/enter/i);
  });

  it("rejects whitespace-only input", () => {
    const r = validateNewCreator("   ", VALID_ADDRESS);
    expect(r.ok).toBe(false);
  });

  it("rejects malformed addresses", () => {
    expect(validateNewCreator("not-an-address", VALID_ADDRESS).ok).toBe(false);
    expect(validateNewCreator("0x123", VALID_ADDRESS).ok).toBe(false);
    expect(validateNewCreator("1234567890abcdef1234567890abcdef12345678", VALID_ADDRESS).ok).toBe(false);
  });

  it("rejects the zero address", () => {
    const r = validateNewCreator(ZERO_ADDRESS, VALID_ADDRESS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/zero/i);
  });

  it("rejects when the new address equals the current creator (case-insensitive)", () => {
    expect(validateNewCreator(VALID_ADDRESS, VALID_ADDRESS).ok).toBe(false);
    expect(validateNewCreator(VALID_ADDRESS.toUpperCase(), VALID_ADDRESS).ok).toBe(false);
    expect(validateNewCreator(VALID_ADDRESS, VALID_ADDRESS.toUpperCase()).ok).toBe(false);
  });

  it("accepts a valid, distinct, non-zero address", () => {
    const r = validateNewCreator(ANOTHER_VALID_ADDRESS, VALID_ADDRESS);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.address).toBe(ANOTHER_VALID_ADDRESS);
  });

  it("trims surrounding whitespace before validating", () => {
    const r = validateNewCreator(`  ${ANOTHER_VALID_ADDRESS}  `, VALID_ADDRESS);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.address).toBe(ANOTHER_VALID_ADDRESS);
  });

  // No `currentCreator` snapshot (e.g. the row hasn't loaded yet)
  // shouldn't block submission — the on-chain `InvalidInput` revert
  // is the backstop. We optimistically allow.
  it("allows valid addresses when current creator is unknown", () => {
    const r = validateNewCreator(ANOTHER_VALID_ADDRESS, undefined);
    expect(r.ok).toBe(true);
  });
});
