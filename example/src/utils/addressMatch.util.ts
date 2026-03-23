import type { Address } from "viem";

const addressMatch = (a: Address, b: Address) => {
  return a.toLowerCase() === b.toLowerCase();
};

export default addressMatch;
