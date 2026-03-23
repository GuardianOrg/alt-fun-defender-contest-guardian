export const getLeverageTokenSymbol = (
  symbol: string,
  selectedLeverage: number,
  selectedLongShort: "long" | "short",
) => {
  return (
    symbol +
    selectedLeverage.toString() +
    (selectedLongShort === "long" ? "L" : "S")
  );
};
