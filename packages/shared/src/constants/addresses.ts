export const CONTRACT_ADDRESSES = {
  bonding: "0xb68811BcC0e4FcD825aA49F9453b065ddF752FcB",
  factory: "0xd5E5Fef4cFeFb67bbA0aA1dc74B2Cd196B4786AC",
  router: "0x70c7eC6f85B960379b7ee60Af72E0f419d915878",
  zap: "0x693F12E9E6B35b34458793546065E8b08e0299d6",
  lpLock: "0x8Deb9603d5F31471E993c23f73E4bDdB702a7476",
  feeVault: "0xb4894380282533A86cb241145fac54AaAc995F18",
  tokenImplementation: "0xfbEc3D3c42427Dc2c08A2401e53758F02cecB540",
  /**
   * `BotFeeRouter` is operated by the Telegram-bot team and deployed
   * independently of the Alt Fun protocol. Deployed at block
   * `BOT_FEE_ROUTER_START_BLOCK` (see `./chains.ts`); the indexer's
   * Ponder source uses that block to scope its backfill. NOTE: this
   * address points to the previous protocol's `Zap`. The bot-team
   * needs to redeploy `BotFeeRouter` against the new `Zap`
   * (`0x693F12E9E6B35b34458793546065E8b08e0299d6`) and update this
   * field plus `BOT_FEE_ROUTER_START_BLOCK` once that's done.
   */
  botFeeRouter: "0xB2b2d9c0c837a723fC27C27e097B384400796947",
} as const;

export const HYPERSWAP_ADDRESSES = {
  factory: "0x724412C00059bf7d6ee7d4a1d0D5cd4de3ea1C48",
  router: "0xb4a9C4e6Ea8E2191d2FA5B380452a634Fb21240A",
} as const;
