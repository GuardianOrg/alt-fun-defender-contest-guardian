import { createConfig } from "@ponder/core";
import { http } from "viem";

import { BondingAbi } from "@bounce/shared";

export default createConfig({
  networks: {
    hyperevm: {
      chainId: 999,
      transport: http(process.env.PONDER_RPC_URL_999),
    },
  },
  contracts: {
    Bonding: {
      network: "hyperevm",
      abi: BondingAbi,
      address: "0x0000000000000000000000000000000000000000" as `0x${string}`,
      startBlock: 0,
    },
  },
});
