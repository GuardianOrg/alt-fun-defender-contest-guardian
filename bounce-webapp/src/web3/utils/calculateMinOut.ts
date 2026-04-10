export const calculateMinOut = (
  expectedAmount: bigint,
  leverage: number,
): bigint => {
  const BASE_SLIPPAGE_BPS = 30n;

  const slippageBps = BASE_SLIPPAGE_BPS * BigInt(leverage);
  const minOut = (expectedAmount * (10_000n - slippageBps)) / 10_000n;

  return minOut;
};
