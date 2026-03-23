export const bigIntToString = (value: bigint, decimals: number): string => {
  const multiplier = value < 0n ? -1n : 1n;
  value = value * multiplier;

  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  let fraction = (value % base).toString();

  while (fraction.length < decimals) {
    fraction = "0" + fraction;
  }

  fraction = fraction.replace(/0+$/, "");

  const result =
    fraction.length > 0 ? `${whole.toString()}.${fraction}` : whole.toString();

  return multiplier < 0n ? `-${result}` : result;
};
