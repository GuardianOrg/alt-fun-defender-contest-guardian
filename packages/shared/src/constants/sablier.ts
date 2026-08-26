/**
 * Sablier Lockup v4.0 on HyperEVM — the escrow contract that holds tokens
 * locked through app.sablier.com. Verified against
 * `sablier-labs/sdk` → `deployments/lockup/v4.0/broadcasts/hyperevm.json`
 * (deployed at block 29,984,262, i.e. before any Alt Fun token existed, so
 * the indexer can scope its backfill to `BONDING_START_BLOCK`).
 *
 * v3.0 (`0x50ff828e66612a4d1f7141936f2b4078c7356329`) and v2.0
 * (`0x856167ee3e09ba562d69a542ab6a939903ad738e`) are also live on HyperEVM
 * but are deliberately not indexed: app.sablier.com only creates streams on
 * the latest release, and each older release has a different event signature.
 * A lock placed on an older version simply doesn't count — under-reporting is
 * the safe direction for a trust signal.
 *
 * Lowercased because both consumers compare against lowercased addresses
 * (Ponder normalises log addresses; the holders table lowercases wallets).
 */
export const SABLIER_LOCKUP_ADDRESS =
  "0x5369e34c92eacc1cceaffe1be01f057c68ca1b19" as const;
