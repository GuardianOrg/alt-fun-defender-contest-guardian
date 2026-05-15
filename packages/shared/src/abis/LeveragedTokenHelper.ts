/**
 * BounceTech `LeveragedTokenHelper` (lightly-audited helper contract that sits
 * outside the core BounceTech protocol — see the BounceTech integration guide
 * at https://docs.bounce.tech/technical/integration-guide).
 *
 * Exposes batched view-functions that return per-LT data (`exchangeRate`,
 * `mintPaused`, `targetAsset`, `targetLeverage`, `isLong`, `baseAssetBalance`,
 * `totalAssets`, …) without one RPC call per LT. Alt Fun's
 * `lt-directory-poller` Durable Object reads from this helper as an
 * on-chain replacement for the now-deprecated `indexing.bounce.tech` HTTP
 * directory.
 *
 * Vendored from `@bouncetech/contracts`
 * (https://github.com/bounce-tech/bounce-npm) — we don't depend on the
 * npm package directly so the API runtime on Cloudflare Workers stays
 * isolate-cold-start-fast and ABI drift is caught by the typed
 * `viem.readContract` signature instead of by a string-named import that
 * could silently update under us.
 *
 * Only the subset of the helper's surface we actually call is included
 * here — `getLeveragedTokens()` returns the full live directory in one
 * call. Other helper entry points
 * (`getExchangeRates`, `getLeveragedTokenPositionData`,
 * `getLeveragedTokensSnapshot`, …) are intentionally left out; add them
 * only when a concrete consumer materialises.
 */
export const LeveragedTokenHelperAbi = [
  {
    type: "function",
    name: "getLeveragedTokens",
    stateMutability: "view",
    inputs: [],
    outputs: [
      {
        type: "tuple[]",
        components: [
          { name: "leveragedToken", type: "address" },
          { name: "marketId", type: "uint32" },
          { name: "targetAsset", type: "string" },
          { name: "targetLeverage", type: "uint256" },
          { name: "isLong", type: "bool" },
          { name: "exchangeRate", type: "uint256" },
          { name: "baseAssetBalance", type: "uint256" },
          { name: "totalAssets", type: "uint256" },
          { name: "hyperliquidNotional", type: "uint256" },
          { name: "userCredit", type: "uint256" },
          { name: "credit", type: "uint256" },
          {
            name: "agentData",
            type: "tuple[3]",
            components: [
              { name: "slot", type: "uint8" },
              { name: "agent", type: "address" },
              { name: "createdAt", type: "uint256" },
            ],
          },
          { name: "balanceOf", type: "uint256" },
          { name: "mintPaused", type: "bool" },
          { name: "isStandbyMode", type: "bool" },
        ],
      },
    ],
  },
] as const;
