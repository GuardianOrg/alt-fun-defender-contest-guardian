export const CONTRACT_ADDRESSES = {
  bonding: "0x1E75bB0570e4d1c4490417C0948A37e8d6809638",
  factory: "0x6fC8ff7b2e595742298Fc876c3c755a9640B4035",
  router: "0x6424c4732c3f02930d5eF9D5ab041F1D9867Fecf",
  zap: "0x0DC348C1eDB757C6Ec6a8045fC2D85d7fA2dbc21",
  lpLock: "0x580C97D07d313b404d615b61D0f195b0Ca2c6598",
  feeVault: "0x3B86E3A9cDE902DCa3316c5788686aa8567477b1",
  tokenImplementation: "0xe6A0C9D82471219C3520Cc8ec309A4b222c28cA3",
  /**
   * `BotFeeRouter` is operated by the Telegram-bot team and deployed
   * independently of the Alt Fun protocol. Until that deploy lands the
   * address is the zero sentinel — the indexer keeps the contract entry
   * in `ponder.config.ts` but no logs ever match, so the bot entity
   * tables (`walletBotPosition`, `referrerStats`, `botRouterTrade`)
   * stay empty and the API's `/api/v1/bot/*` routes return zeroed data
   * cleanly. Replace with the deployed address once the router ships.
   */
  botFeeRouter: "0x0000000000000000000000000000000000000000",
} as const;

export const HYPERSWAP_ADDRESSES = {
  factory: "0x724412C00059bf7d6ee7d4a1d0D5cd4de3ea1C48",
  router: "0xb4a9C4e6Ea8E2191d2FA5B380452a634Fb21240A",
} as const;
