export const HYPER_EVM = {
  id: 999,
  name: "HyperEVM",
  rpcUrl: "https://rpc.hyperliquid.xyz/evm",
} as const;

export const SUPPORTED_CHAINS = [HYPER_EVM] as const;

export const BONDING_START_BLOCK = 33313542;
