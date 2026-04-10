# Launchpad

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
apps/api/        — Hono on Cloudflare Workers, Drizzle ORM, Neon (PostgreSQL), R2 (image storage), Durable Objects (WebSocket)
apps/indexer/    — Ponder (EVM indexer), GraphQL API, hosted on Railway
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
| HyperSwap swap (post-grad) | 0.3% | LPs (launchpad takes 0%) |
| LT redemption | BounceTech internal | No additional launchpad fee |

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
redeem(to, ltAmount, minBase) → baseAmount  // LT → USDC. Atomic only.
exchangeRate() → uint256                    // USD per LT unit (18 decimals)
targetLeverage() → uint256                  // 2, 3, or 5
baseAssetBalance() → uint256               // Idle USDC available for atomic redeem
```

### Key Constraints

- **Atomic redeems only.** We do NOT use `prepareRedeem()`. All sells go through `redeem()` which is atomic but limited by the LT's idle USDC buffer (`baseAssetBalance()`).
- **Buffer-limited sells:** If a sell would redeem more USDC than `baseAssetBalance()`, `redeem()` reverts with `InsufficientBalance`. The frontend must check `baseAssetBalance()` before selling and cap sell amounts accordingly.
- **Sell in chunks:** When a user wants to sell more than the buffer allows, they sell in smaller amounts. BounceTech's automation layer replenishes the idle USDC buffer in ~10 seconds after each redeem, so the user can sell again shortly.
- **Minimum mint/redeem: `$10` USDC.** Amounts below this revert with `0x05eb05ac`. The frontend must enforce this minimum on buy/sell inputs.
- BounceTech charges redemption fees internally. We don't add our own.

### BounceTech Indexing API

Base URL: `https://indexing.bounce.tech`

Key endpoints used by the launchpad:

| Endpoint | Purpose |
|---|---|
| `GET /leveraged-tokens` | All LT addresses, exchange rates, metadata |
| `GET /leveraged-tokens/:symbol` | Single LT by symbol (e.g. `HYPE3L`) |
| `GET /trade/:txHash` | Confirm trade indexing by transaction hash |

No auth required. Fair use policy applies. Implement caching to reduce calls.

### Hyperliquid Price API

Used for underlying asset spot prices (HYPE, ETH, BTC, SOL, etc.).

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `https://api.hyperliquid.xyz/info` `{"type":"allMids"}` | All mid-prices (REST) |
| WS | `wss://api.hyperliquid.xyz/ws` subscribe `{"type":"allMids"}` | Real-time price stream |
| POST | `https://api.hyperliquid.xyz/info` `{"type":"candleSnapshot","req":{...}}` | OHLCV candles (1m to 1M intervals) |

No auth required.

### Contract Addresses

| Contract | Address |
|---|---|
| USDC (HyperEVM) | `0xb88339CB7199b77E23DB6E890353E22632Ba630f` |
| HyperSwap V2 Factory | `0x724412C00059bf7d6ee7d4a1d0D5cd4de3ea1C48` |
| HyperSwap V2 Router | `0xb4a9C4e6Ea8E2191d2FA5B380452a634Fb21240A` |

### Infrastructure

| Service | Provider | Details |
|---|---|---|
| Database | Neon (PostgreSQL) | Direct connection (no Hyperdrive) |
| Image storage | Cloudflare R2 | Bucket: `launchpad-images`, served via Worker |
| WebSocket | Cloudflare Durable Objects | Real-time trade/price feeds |
| Indexer hosting | Railway | Persistent process for Ponder |
| RPC | Alchemy | HyperEVM mainnet |
| Frontend hosting | Cloudflare Pages | Project: `launchpad` |
| API hosting | Cloudflare Workers | Worker: `launchpad-api` |
| Auth | Privy | Social login, embedded wallets, WalletConnect |

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

---

## Image Upload & Content Moderation

Token creators upload images (not URLs). Images are stored in Cloudflare R2 and served via the API Worker. Before storage, images are scanned for illegal content (CSAM, extreme violence). Adult content is permitted as long as it is legal. The moderation check happens server-side before the image is persisted to R2.

## Password Gate

The frontend has a temporary password gate (`PasswordGate` component) for pre-launch testing. This will be removed before public launch. It is NOT a security feature — just a deterrent for casual visitors during development.

## Admin Authentication

Admin endpoints (`/admin/*`) are authenticated via a shared admin API key passed in the `X-Admin-Key` header. The key is stored as a Cloudflare Worker secret (`ADMIN_API_KEY`). This is a simple v1 approach — wallet-based admin auth can be added later.

## Referrals

v1 tracks referrals only (no on-chain fee split). The `buy()` function accepts a `referrer` address parameter. `Referred` events are emitted and indexed for analytics. Payouts are deferred to v2.

## Open Tasks

See `TODO.md` in the repo root for outstanding work items. This is the single source of truth for open tasks. When completing a task, remove it from `TODO.md`. When discovering new work, add it there.
