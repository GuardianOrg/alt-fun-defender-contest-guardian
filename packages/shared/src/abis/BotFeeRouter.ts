/**
 * BotFeeRouter — external bot operator's fee-skimming router that wraps
 * Alt Fun's Zap. Spec lives in `apps/telegram-bot/AGENTS.md → Bot Fee Model`.
 * The contract is owned and deployed by the bot team, not by Alt Fun, and is
 * not in this repo's `packages/contracts/`. This ABI is hand-derived from the
 * functional spec — when the canonical Solidity source lands, regenerate from
 * Foundry artifacts via the same export-abi flow used for `Zap`, etc.
 *
 * Only the surface the telegram bot needs is included:
 *   - `sellWithBotFee` / `sellWithBotFeePermit` — for `simulateContract` sell
 *     quotes (issue #686) and eventual tx submission.
 *   - `buyWithBotFee`  / `buyWithBotFeePermit`  — symmetric, for buy flow.
 *   - `BotRouterTrade` / `ReferralPaid` events — consumed by the indexer.
 */
export const BotFeeRouterAbi = [
  {
    type: "function",
    name: "buyWithBotFee",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "usdcAmount", type: "uint256" },
      { name: "minTokensOut", type: "uint256" },
      { name: "referrer", type: "address" },
    ],
    outputs: [{ name: "tokensOut", type: "uint256" }],
  },
  {
    type: "function",
    name: "buyWithBotFeePermit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "usdcAmount", type: "uint256" },
      { name: "minTokensOut", type: "uint256" },
      { name: "referrer", type: "address" },
      { name: "deadline", type: "uint256" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
    outputs: [{ name: "tokensOut", type: "uint256" }],
  },
  {
    type: "function",
    name: "sellWithBotFee",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "tokenAmount", type: "uint256" },
      { name: "minUsdcOut", type: "uint256" },
      { name: "referrer", type: "address" },
    ],
    outputs: [{ name: "usdcOut", type: "uint256" }],
  },
  {
    type: "function",
    name: "sellWithBotFeePermit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "tokenAmount", type: "uint256" },
      { name: "minUsdcOut", type: "uint256" },
      { name: "referrer", type: "address" },
      { name: "deadline", type: "uint256" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
    outputs: [{ name: "usdcOut", type: "uint256" }],
  },
  {
    type: "function",
    name: "botFeeBps",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint16" }],
  },
  {
    type: "function",
    name: "referrerShareBps",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint16" }],
  },
  {
    type: "function",
    name: "treasury",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "event",
    name: "BotRouterTrade",
    inputs: [
      { indexed: true, name: "trader", type: "address" },
      { indexed: true, name: "token", type: "address" },
      { indexed: false, name: "side", type: "uint8" },
      { indexed: false, name: "usdcAmount", type: "uint256" },
      { indexed: false, name: "tokenAmount", type: "uint256" },
      { indexed: false, name: "botFee", type: "uint256" },
      { indexed: true, name: "referrer", type: "address" },
      { indexed: false, name: "referrerCut", type: "uint256" },
      { indexed: false, name: "treasuryCut", type: "uint256" },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "ReferralPaid",
    inputs: [
      { indexed: true, name: "referrer", type: "address" },
      { indexed: true, name: "user", type: "address" },
      { indexed: false, name: "amount", type: "uint256" },
      { indexed: true, name: "token", type: "address" },
      { indexed: false, name: "side", type: "uint8" },
    ],
    anonymous: false,
  },
] as const;
