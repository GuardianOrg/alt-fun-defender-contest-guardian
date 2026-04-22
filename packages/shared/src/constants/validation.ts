/**
 * Token name/symbol validation limits.
 *
 * These constants are the canonical source of truth. They are hard enforced
 * on the smart contract side (Bonding.launch) and replicated here for the
 * API, webapp, and any other off-chain consumer to give users clear UX
 * before submitting an on-chain transaction.
 *
 * Changing these values requires a redeploy of the Bonding contract.
 *
 * Units: UTF-8 byte length — matches Solidity's `bytes(str).length`.
 * A single emoji can be up to 4 bytes, so a 10-char emoji ticker would
 * revert on-chain. We validate bytes (not JS UTF-16 code units) so off-chain
 * and on-chain rules agree.
 */

export const MIN_TOKEN_NAME_LENGTH = 1 as const;
export const MAX_TOKEN_NAME_LENGTH = 34 as const;

export const MIN_TOKEN_SYMBOL_LENGTH = 1 as const;
export const MAX_TOKEN_SYMBOL_LENGTH = 10 as const;

const encoder = new TextEncoder();

/** UTF-8 byte length of a string. Matches Solidity's `bytes(str).length`. */
export function utf8ByteLength(str: string): number {
  return encoder.encode(str).length;
}

export function isValidTokenName(name: string): boolean {
  const len = utf8ByteLength(name);
  return len >= MIN_TOKEN_NAME_LENGTH && len <= MAX_TOKEN_NAME_LENGTH;
}

export function isValidTokenSymbol(symbol: string): boolean {
  const len = utf8ByteLength(symbol);
  return len >= MIN_TOKEN_SYMBOL_LENGTH && len <= MAX_TOKEN_SYMBOL_LENGTH;
}
