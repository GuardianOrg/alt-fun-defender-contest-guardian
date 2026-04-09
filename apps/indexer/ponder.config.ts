import { createConfig } from "@ponder/core";
import { http } from "viem";

import { BondingAbi, CONTRACT_ADDRESSES, HYPER_EVM } from "@launchpad/shared";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const bondingAddress = CONTRACT_ADDRESSES.bonding as `0x${string}`;
const startBlock = Number(process.env.BONDING_START_BLOCK ?? 0);

if (bondingAddress === ZERO_ADDRESS) {
  throw new Error(
    "Bonding contract address is not set — update CONTRACT_ADDRESSES in @launchpad/shared before running the indexer",
  );
}

export default createConfig({
  networks: {
    hyperevm: {
      chainId: HYPER_EVM.id,
      transport: http(process.env.PONDER_RPC_URL_999),
    },
  },
  contracts: {
    Bonding: {
      network: "hyperevm",
      abi: BondingAbi,
      address: bondingAddress,
      startBlock,
    },
  },
});
