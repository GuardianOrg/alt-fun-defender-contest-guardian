# packages/contracts

Forked from Virtuals Protocol `contracts/fun`. Solidity 0.8.x, Foundry.

## What This Package Does

Bonding curve system where the reserve asset is a BounceTech Leveraged Token (LT) instead of USDC. Users interact via `RedemptionRouter` which abstracts LT — they only see USDC in/out.

```
User → USDC → RedemptionRouter → mint LT → Bonding.buy() → FPair (memecoin/LT) → memecoin
Graduation → Bonding._graduate() → HyperSwap V2 pool (memecoin/LT) → LP locked
```

## Contracts

| Contract | Description |
|---|---|
| `Bonding.sol` | Launch, buy, sell, graduation, fee collection |
| `FFactory.sol` | Pair registry, fee config (needs multi-LT support) |
| `FRouter.sol` | AMM math, buy/sell execution |
| `FPair.sol` | Per-token pair: reserves, k-constant (asset-agnostic, no changes) |
| `FERC20.sol` | Memecoin ERC20 with burn |
| `RedemptionRouter.sol` | New — USDC abstraction, LT mint/redeem, referral events |
| `LPLock.sol` | New — graduation LP lock (UUPS, no withdraw in v1) |

## Functional Spec

Full requirements (buy/sell flows, graduation, events, fee structure): `docs/contracts-scope.md`
