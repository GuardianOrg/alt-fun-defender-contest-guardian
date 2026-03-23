const PRECISION_BUCKETS = [
  { min: 10_000, decimals: 0 },
  { min: 1_000, decimals: 1 },
  { min: 100, decimals: 2 },
  { min: 10, decimals: 3 },
  { min: 1, decimals: 4 },
  { min: 0.1, decimals: 5 },
  { min: 0, decimals: 6 },
] as const;

const getAdaptiveDecimals = (value: number) => {
  const abs = Math.abs(value);
  return PRECISION_BUCKETS.find((b) => abs >= b.min)?.decimals ?? 2;
};

export const formatNumber = (
  amount?: number,
  percentage = false,
  dollarSign = false,
  adaptivePrecision = false,
) => {
  if (typeof amount !== "number") {
    return "--";
  }

  const isNegative = amount < 0;
  const absoluteAmount = Math.abs(amount);

  const decimals = adaptivePrecision ? getAdaptiveDecimals(absoluteAmount) : 2;

  const isLessThanOne = adaptivePrecision && absoluteAmount < 1;

  const formatted = absoluteAmount.toLocaleString("en-US", {
    minimumFractionDigits: isLessThanOne ? 0 : decimals,
    maximumFractionDigits: decimals,
  });

  return (
    (isNegative ? "-" : "") +
    (dollarSign ? "$" : "") +
    formatted +
    (percentage ? "%" : "")
  );
};
