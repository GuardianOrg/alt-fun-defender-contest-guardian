import { mainnet } from "viem/chains";
import { useEnsName } from "wagmi";

import formatAddress from "../utils/formatAddress.util";

import type { Address } from "viem";

const useFormatAddress = (address: Address | null, shorten?: boolean) => {
  const { data: ensName } = useEnsName({
    address: address ?? undefined,
    chainId: mainnet.id,
  });

  if (ensName) return ensName;
  return formatAddress(address, shorten);
};

export default useFormatAddress;
