/**
 * Sablier Lockup v4.0 — the third-party token-vesting escrow creators use
 * (via app.sablier.com) to lock a token's supply. Trimmed to the single
 * event the indexer subscribes to; copied verbatim from the official v4.0
 * artifact so the derived topic0 matches the deployed contract byte for
 * byte.
 *
 * Source: `sablier-labs/sdk` → `deployments/lockup/v4.0/artifacts/SablierLockup.json`.
 *
 * Do not hand-edit the parameter list. topic0 is derived from it, and a
 * single drift makes Ponder's log filter match nothing — the table stays
 * silently empty with no error anywhere (the issue-#418 failure mode).
 * `apps/indexer/test/sablier.test.ts` pins the hash against a log observed
 * on-chain.
 */
export const SablierLockupAbi = [
  {
    type: "event",
    name: "CreateLockupLinearStream",
    inputs: [
      {
        name: "streamId",
        type: "uint256",
        indexed: true,
        internalType: "uint256",
      },
      {
        name: "commonParams",
        type: "tuple",
        indexed: false,
        internalType: "struct Lockup.CreateEventCommon",
        components: [
          { name: "funder", type: "address", internalType: "address" },
          { name: "sender", type: "address", internalType: "address" },
          { name: "recipient", type: "address", internalType: "address" },
          { name: "depositAmount", type: "uint128", internalType: "uint128" },
          { name: "token", type: "address", internalType: "contract IERC20" },
          { name: "cancelable", type: "bool", internalType: "bool" },
          { name: "transferable", type: "bool", internalType: "bool" },
          {
            name: "timestamps",
            type: "tuple",
            internalType: "struct Lockup.Timestamps",
            components: [
              { name: "start", type: "uint40", internalType: "uint40" },
              { name: "end", type: "uint40", internalType: "uint40" },
            ],
          },
          { name: "shape", type: "string", internalType: "string" },
        ],
      },
      {
        name: "cliffTime",
        type: "uint40",
        indexed: false,
        internalType: "uint40",
      },
      {
        name: "granularity",
        type: "uint40",
        indexed: false,
        internalType: "uint40",
      },
      {
        name: "unlockAmounts",
        type: "tuple",
        indexed: false,
        internalType: "struct LockupLinear.UnlockAmounts",
        components: [
          { name: "start", type: "uint128", internalType: "uint128" },
          { name: "cliff", type: "uint128", internalType: "uint128" },
        ],
      },
    ],
    anonymous: false,
  },
] as const;
