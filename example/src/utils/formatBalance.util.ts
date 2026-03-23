import { formatUnits } from "viem";

export const formatBalance = (
  value: bigint,
  decimals = 18,
  precision = 4,
  minimumFractionDigits = 0,
) => {
  const formatted = formatUnits(value, decimals);
  return Number(formatted).toLocaleString(undefined, {
    minimumFractionDigits: minimumFractionDigits,
    maximumFractionDigits: precision,
  });
};
