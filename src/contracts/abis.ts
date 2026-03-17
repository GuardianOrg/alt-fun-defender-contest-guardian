/**
 * ABI stubs for contract integration.
 *
 * Transaction flow (all atomic, user only touches USDC):
 *
 *   BUY:  User approves USDC → Router.buy()
 *         Router: takes USDC → mints LT (via BounceTech) → deposits LT into bonding curve → sends memecoin to user
 *
 *   SELL: User approves memecoin → Router.sell()
 *         Router: takes memecoin → withdraws LT from bonding curve → redeems LT (via BounceTech) → sends USDC to user
 *
 *   CREATE: User approves USDC (for seed buy) → Factory.create()
 *           Factory: deploys curve + token → optional seed buy through router → sends tokens to creator
 *
 * The LT layer is fully abstracted — users never hold or see LTs.
 * All calls go through the Bounce Referral Module for fee attribution.
 *
 * Replace these stubs with real ABIs from the contract repo when ready.
 */

export const erc20Abi = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

export const txRouterAbi = [
  {
    name: 'buy',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'curveAddress', type: 'address' },
      { name: 'usdcAmount', type: 'uint256' },
      { name: 'minTokensOut', type: 'uint256' },
      { name: 'referralCode', type: 'bytes32' },
    ],
    outputs: [{ name: 'tokensReceived', type: 'uint256' }],
  },
  {
    name: 'sell',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'curveAddress', type: 'address' },
      { name: 'tokenAmount', type: 'uint256' },
      { name: 'minUsdcOut', type: 'uint256' },
      { name: 'referralCode', type: 'bytes32' },
    ],
    outputs: [{ name: 'usdcReceived', type: 'uint256' }],
  },
  {
    name: 'getQuoteBuy',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'curveAddress', type: 'address' },
      { name: 'usdcAmount', type: 'uint256' },
    ],
    outputs: [
      { name: 'tokensOut', type: 'uint256' },
      { name: 'curveFee', type: 'uint256' },
      { name: 'priceImpactBps', type: 'uint256' },
    ],
  },
  {
    name: 'getQuoteSell',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'curveAddress', type: 'address' },
      { name: 'tokenAmount', type: 'uint256' },
    ],
    outputs: [
      { name: 'usdcOut', type: 'uint256' },
      { name: 'curveFee', type: 'uint256' },
      { name: 'ltRedemptionFee', type: 'uint256' },
      { name: 'priceImpactBps', type: 'uint256' },
    ],
  },
] as const;

export const curveFactoryAbi = [
  {
    name: 'createToken',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'ticker', type: 'string' },
      { name: 'ltAddress', type: 'address' },
      { name: 'metadataUri', type: 'string' },
      { name: 'seedBuyUsdc', type: 'uint256' },
      { name: 'referralCode', type: 'bytes32' },
    ],
    outputs: [
      { name: 'tokenAddress', type: 'address' },
      { name: 'curveAddress', type: 'address' },
    ],
  },
] as const;
