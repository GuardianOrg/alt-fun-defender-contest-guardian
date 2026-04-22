/**
 * Token name/symbol validation limits.
 *
 * These constants are the canonical source of truth. They are hard enforced
 * on the smart contract side (Bonding.launch) and replicated here for the
 * API, webapp, and any other off-chain consumer to give users clear UX
 * before submitting an on-chain transaction.
 *
 * Changing these values requires a redeploy of the Bonding contract.
 */

export const MIN_TOKEN_NAME_LENGTH = 1 as const;
export const MAX_TOKEN_NAME_LENGTH = 34 as const;

export const MIN_TOKEN_SYMBOL_LENGTH = 1 as const;
export const MAX_TOKEN_SYMBOL_LENGTH = 10 as const;
