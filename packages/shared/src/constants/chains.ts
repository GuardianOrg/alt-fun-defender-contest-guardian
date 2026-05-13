export const HYPER_EVM = {
  id: 999,
  name: "HyperEVM",
  rpcUrl: "https://rpc.hyperliquid.xyz/evm",
} as const;

export const SUPPORTED_CHAINS = [HYPER_EVM] as const;

export const BONDING_START_BLOCK = 34844516;

/**
 * Block at which the team-owned `BotFeeRouter` (the contract behind the
 * Telegram bot's fee/referral model) was deployed. Used by the indexer
 * to scope its backfill — without it Ponder would scan from
 * `BONDING_START_BLOCK` over a window where the router didn't exist yet.
 * Override at runtime with `BOT_FEE_ROUTER_START_BLOCK` if the router is
 * ever redeployed.
 */
export const BOT_FEE_ROUTER_START_BLOCK = 34995303;
