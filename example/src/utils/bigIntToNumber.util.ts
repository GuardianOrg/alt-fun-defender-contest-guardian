export const bigIntToNumber = (value: bigint, decimals: number): number => {
  const isNegative = value < 0n;
  const absValue = isNegative ? -value : value;

  const base = 10n ** BigInt(decimals);
  const whole = Number(absValue / base);
  const fraction = Number(absValue % base) / Number(base);

  const result = whole + fraction;

  return isNegative ? -result : result;
};
