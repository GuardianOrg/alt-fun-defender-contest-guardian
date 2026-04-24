import { createConfig, factory } from "ponder";
import { parseAbiItem } from "viem";

import {
  BondingAbi,
  FeeVaultAbi,
  FERC20Abi,
  FFactoryAbi,
  LaunchpadRouterAbi,
  UniswapV2PairAbi,
  CONTRACT_ADDRESSES,
  HYPER_EVM,
  BONDING_START_BLOCK,
} from "@launchpad/shared";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const bondingAddress = CONTRACT_ADDRESSES.bonding as `0x${string}`;
const factoryAddress = CONTRACT_ADDRESSES.factory as `0x${string}`;
const launchpadRouterAddress = CONTRACT_ADDRESSES.launchpadRouter as `0x${string}`;
const feeVaultAddress = CONTRACT_ADDRESSES.feeVault as `0x${string}`;
const startBlock = Number(process.env.BONDING_START_BLOCK ?? BONDING_START_BLOCK);

if (bondingAddress === ZERO_ADDRESS) {
  throw new Error(
    "Bonding contract address is not set — update CONTRACT_ADDRESSES in @launchpad/shared before running the indexer",
  );
}

export default createConfig({
  chains: {
    hyperevm: {
      id: HYPER_EVM.id,
      rpc: process.env.PONDER_RPC_URL_999,
      ethGetLogsBlockRange: 10_000,
    },
  },
  contracts: {
    Bonding: {
      chain: "hyperevm",
      abi: BondingAbi,
      address: bondingAddress,
      startBlock,
    },
    FFactory: {
      chain: "hyperevm",
      abi: FFactoryAbi,
      address: factoryAddress,
      startBlock,
    },
    LaunchpadRouter: {
      chain: "hyperevm",
      abi: LaunchpadRouterAbi,
      address: launchpadRouterAddress,
      startBlock,
    },
    FeeVault: {
      chain: "hyperevm",
      abi: FeeVaultAbi,
      address: feeVaultAddress,
      startBlock,
    },
    FERC20Token: {
      chain: "hyperevm",
      abi: FERC20Abi,
      address: factory({
        address: bondingAddress,
        event: parseAbiItem(
          "event TokenLaunched(address indexed token, address indexed creator, address ltAddress, string name, string ticker, uint256 k, uint256 index)",
        ),
        parameter: "token",
      }),
      startBlock,
    },
    HyperSwapPair: {
      chain: "hyperevm",
      abi: UniswapV2PairAbi,
      address: factory({
        address: bondingAddress,
        event: parseAbiItem(
          "event TokenGraduated(address indexed token, address pairAddress, uint256 liquidity, uint256 tokensInLP, uint256 lpBurned, uint256 unsoldBurned)",
        ),
        parameter: "pairAddress",
      }),
      startBlock,
    },
  },
});
