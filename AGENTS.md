# bounce.fun

Memecoin launchpad on HyperEVM. Every token's bonding curve holds a BounceTech Leveraged Token (LT) as its reserve asset. Tokens appreciate from buy pressure AND leveraged movement of the underlying.

---

## How It Works

1. **Create:** Creator picks an underlying asset + leverage (e.g. HYPE 2x Long) and launches a memecoin
2. **Buy:** User sends USDC → Router mints LT → LT enters bonding curve → user gets memecoin
3. **Sell:** User sends memecoin → Router sells on curve → redeems LT → user gets USDC
4. **Graduate:** When curve hits `$12K` raised → unsold tokens burned → MEMECOIN/LT pool on HyperSwap V2, LP locked
5. **Post-grad:** Trading continues through Router on HyperSwap. Leveraged exposure persists.

The `RedemptionRouter` is the only user-facing entry point. Users always pay and receive USDC.

---

## Architecture

```
apps/web/        — React 19, Vite 7, CSS Modules, Redux Toolkit, TanStack Query, Privy, lightweight-charts
apps/api/        — Hono on Cloudflare Workers, Drizzle ORM, Neon (PostgreSQL) via Hyperdrive
apps/indexer/    — Ponder (EVM indexer), GraphQL API
packages/contracts/ — Foundry (Solidity), forked from Virtuals Protocol
packages/shared/ — Shared types, ABIs (generated from Foundry), constants, contract addresses
packages/config/ — Shared ESLint and TypeScript configs
```

Data flow: Contracts emit events → Ponder indexes into GraphQL (read path). Hono API handles off-chain data (write path). Frontend queries both + uses Privy for wallet interactions.

---

## Product Parameters

| Parameter | Value |
|---|---|
| Curve type | Constant-product (Virtuals Bonding.sol fork) |
| Supply | 1B fixed per token |
| Curve/LP split | 75% on curve / 25% to DEX pool |
| K parameter | Dynamic per token — computed at `launch()` from LT's `exchangeRate()` |
| Opening market cap | ~`$4K` |
| Graduation market cap | ~`$64K` |
| Graduation threshold | ~`$12K` USDC raised (at launch-time exchange rate) |
| Graduation trigger | `LT_reserves × exchangeRate ≥ $12K` — burn unsold tokens |
| User-facing currency | USDC in / USDC out. LT fully abstracted. |
| Post-grad venue | HyperSwap V2 |
| Post-grad pair | MEMECOIN/LT (leveraged exposure persists) |
| LP handling | Locked in `LPLock.sol` (UUPS upgradeable, no withdraw in v1) |
| Leverage options | 2x, 3x, 5x (5x gets vol decay warning) |
| Wallet | Privy (social login, embedded wallets, WalletConnect) |

## Fees

| Fee | Rate | Split |
|---|---|---|
| Curve buy | 0.5% | 0.4% protocol / 0.1% creator |
| Curve sell | 0.5% | 0.4% protocol / 0.1% creator |
| HyperSwap swap (post-grad) | 0.3% | LPs (bounce.fun takes 0%) |
| LT redemption | BounceTech internal | No additional bounce.fun fee |

---

## Token Lifecycle

**Phase 1 — Bonding Curve:** Creator picks name, image, LT pair. Buys/sells go through RedemptionRouter. Curve reserve is LT.

**Phase 2 — Graduation:** Trigger fires → unsold tokens burned → LT reserve collected → MEMECOIN/LT pool on HyperSwap → LP locked → curve closed.

**Phase 3 — Open Trading:** MEMECOIN/LT pool on HyperSwap. All trades still go through RedemptionRouter (USDC in/out).

---

## BounceTech LT Integration

External dependency. BounceTech Leveraged Tokens are the reserve asset in every bonding curve.

### Interface

```
mint(to, baseAmount, minOut) → ltAmount     // USDC → LT. Always atomic.
redeem(to, ltAmount, minBase) → baseAmount  // LT → USDC. Atomic if idle USDC sufficient.
prepareRedeem(ltAmount)                     // Fallback for large amounts. ~15s delay.
exchangeRate() → uint256                    // USD per LT unit (18 decimals)
targetLeverage() → uint256                  // 2, 3, or 5
baseAssetBalance() → uint256               // Idle USDC available for atomic redeem
```

### Key Constraints

- `redeem()` reverts with `InsufficientBalance` if amount exceeds `baseAssetBalance()`
- `prepareRedeem()` has `AlreadyRedeeming` — only ONE pending per address per LT
- Bounce Indexing API (`GET /trade/:txHash`) tracks `prepareRedeem` completion — returns `null` while pending
- BounceTech charges redemption fees internally. We don't add our own.

### Contract Addresses

| Contract | Address |
|---|---|
| HyperSwap V2 Factory | `0x4df039804873717bff7d03694fb941cf0469b79e` |
| HyperSwap V2 Router | `0xda0f518d521e0dE83fAdC8500C2D21b6a6C39bF9` |

---

## Terminology

| Use this | Not this |
|---|---|
| leverage boost | HYPE boost, LT gain |
| bonding curve | curve, bond |
| graduation | migrate, launch (for threshold crossing) |
| seed buy | dev buy, initial buy |
| curve filled | progress, bonding |
| HyperSwap | DEX (when referring to the post-grad venue) |
| LT (Leveraged Token) | leveraged token (always capitalise) |

---

## Functional Specs

| Scope | File |
|---|---|
| Smart contracts | `docs/contracts-scope.md` |
| Backend API | `docs/backend-scope.md` |
| Frontend | `docs/frontend-scope.md` |
