export const positiveOrNegativeClassName = (value?: number) => {
  if (value === undefined) return "";
  if (value === 0) return "";
  if (value > 0) return "positive";
  if (value < 0) return "negative";
};
