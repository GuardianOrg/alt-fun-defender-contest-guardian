import { createConfig } from "@ponder/core";
import { http, parseAbiItem } from "viem";

import {
  BondingAbi,
  RedemptionRouterAbi,
  UniswapV2PairAbi,
  CONTRACT_ADDRESSES,
  HYPER_EVM,
  BONDING_START_BLOCK,
} from "@launchpad/shared";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const bondingAddress = CONTRACT_ADDRESSES.bonding as `0x${string}`;
const redemptionRouterAddress = CONTRACT_ADDRESSES.redemptionRouter as `0x${string}`;
const startBlock = Number(process.env.BONDING_START_BLOCK ?? BONDING_START_BLOCK);

if (bondingAddress === ZERO_ADDRESS) {
  throw new Error(
    "Bonding contract address is not set — update CONTRACT_ADDRESSES in @launchpad/shared before running the indexer",
  );
}

export default createConfig({
  networks: {
    hyperevm: {
      chainId: HYPER_EVM.id,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- viem version mismatch between ponder peer dep and direct dep
      transport: http(process.env.PONDER_RPC_URL_999) as any,
    },
  },
  blocks: {
    ExchangeRatePoller: {
      network: "hyperevm",
      startBlock,
      interval: 10,
    },
  },
  contracts: {
    Bonding: {
      network: "hyperevm",
      abi: BondingAbi,
      address: bondingAddress,
      startBlock,
    },
    RedemptionRouter: {
      network: "hyperevm",
      abi: RedemptionRouterAbi,
      address: redemptionRouterAddress,
      startBlock,
    },
    HyperSwapPair: {
      network: "hyperevm",
      abi: UniswapV2PairAbi,
      factory: {
        address: bondingAddress,
        event: parseAbiItem(
          "event TokenGraduated(address indexed token, address pairAddress, uint256 liquidity)",
        ),
        parameter: "pairAddress",
      },
      startBlock,
    },
  },
});
