export const getIsProfit = (pnlAbsolute: number | undefined): boolean => {
  return typeof pnlAbsolute === "number"
    ? Math.round(pnlAbsolute * 100) / 100 >= 0
    : false;
};
