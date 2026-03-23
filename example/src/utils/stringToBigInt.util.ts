export const stringToBigInt = (value: string, decimals: number): bigint => {
  if (!value || value === ".") throw new Error("errors.invalidNumber");
  value = value.replace(/,/g, "");
  const multiplier = value.substring(0, 1) === "-" ? -1 : 1;
  value = value.replace("-", "");

  const [num, power] = value.split("e");

  if (power) decimals += Number(power);

  const comps = num.split(".");
  const whole = comps[0] || "0";

  if (decimals >= 0) {
    let fraction = comps[1] || "0";
    if (fraction.length <= decimals) {
      while (fraction.length < decimals) fraction += "0";
    } else {
      fraction = fraction.substring(0, decimals) || "0";
    }

    const base = BigInt(10) ** BigInt(decimals);
    return (BigInt(whole) * base + BigInt(fraction)) * BigInt(multiplier);
  }
  const base = BigInt(10) ** BigInt(-decimals);
  return (BigInt(whole) / base) * BigInt(multiplier);
};
