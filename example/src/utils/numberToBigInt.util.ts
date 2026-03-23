export const numberToBigInt = (value: number, decimals: number): bigint => {
  const isNegative = value < 0;
  const absValue = Math.abs(value);

  const base = 10n ** BigInt(decimals);
  const scaled = BigInt(Math.round(absValue * Number(base)));

  return isNegative ? -scaled : scaled;
};
