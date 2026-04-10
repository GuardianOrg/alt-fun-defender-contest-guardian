import type { Address } from "viem";

const formatAddress = (address: Address | null, shorten?: boolean) => {
  if (!address) return "";
  return shorten
    ? address.slice(0, 4) + "..." + address.slice(-2)
    : address.slice(0, 6) + "..." + address.slice(-4);
};

export default formatAddress;
