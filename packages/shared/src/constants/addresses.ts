export const CONTRACT_ADDRESSES = {
  bonding: "0x1944710C55ac3Dcbf36ED9B80f289418B26c032a",
  factory: "0x6EC795a7Ba9987FF32458019Ce1F5D83Aa4dbA22",
  router: "0x0390Fc5A56B2Cb4c22254bCCF3328005d0E11d90",
  launchpadRouter: "0x3E86AFB20De663f8689C09698aEeF3DF5F28a1Fe",
  lpLock: "0x69541E1F67F574612EC6414DCdE6D0bc6588FA76",
  // Placeholder until `FeeVault` is deployed as part of the router-fee
  // migration. The `Deploy.s.sol` script wires it up and emits the real proxy
  // address; replace below, regenerate ABIs, and rerun `npm run ci`. The
  // placeholder is non-zero so the `addresses.test.ts` assertions still pass.
  feeVault: "0x0000000000000000000000000000000000000001",
} as const;

export const HYPERSWAP_ADDRESSES = {
  factory: "0x724412C00059bf7d6ee7d4a1d0D5cd4de3ea1C48",
  router: "0xb4a9C4e6Ea8E2191d2FA5B380452a634Fb21240A",
} as const;
