# Alt Fun

Token launchpad on HyperEVM. Every token's bonding curve holds a BounceTech Leveraged Token (LT) as its reserve asset. Tokens appreciate from buy pressure AND leveraged movement of the underlying.

---

## How It Works

1. **Create:** Creator picks an underlying asset + leverage (e.g. HYPE 2x Long) and launches a token
2. **Buy:** User sends USDC → Router mints LT → LT enters bonding curve → user gets tokens
3. **Sell:** User sends tokens → Router sells on curve → redeems LT → user gets USDC
4. **Graduate:** Dual trigger — curve closes when **either** `raisedLT × exchangeRate ≥ Bonding.graduationThresholdUsd` (default `$12K`, owner-tunable via `setGraduationThresholdUsd`) **or** all 750M curve tokens sold. LP is seeded with exactly the tokens needed to match the last curve price ("dynamic LP seeding" → zero price gap between curve and DEX). Excess LP-reserve tokens and any unsold curve tokens are burned. LP is locked.
5. **Post-grad:** Trading continues through Router on HyperSwap. Leveraged exposure persists.

The `Zap` contract is the only user-facing entry point. Users always pay and receive USDC.

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
| Curve type | Constant-product (Virtuals Bonding.sol fork) with virtual token reserves |
| Supply | 1B fixed per token |
| Curve/LP split | 75% sellable on curve / 25% reserved for LP (excess burned at graduation) |
| Virtual `reserve0` | Initialised at full 1B (`totalSupply`); only 750M real tokens transferred. Pins post-sellout virtual reserve at 250M = `LP_RESERVE` and makes `tokensForLP ≤ LP_RESERVE` a mathematical invariant. |
| K parameter | Dynamic per token — computed at `launch()` from LT's `exchangeRate()` |
| Opening market cap | ~`$4K` |
| Graduation market cap | `~$16K` at launch-time rate when threshold = `$12K` (higher when LT rallies). Threshold itself is owner-mutable. |
| Graduation triggers (dual) | **USD:** `raisedLT × exchangeRate ≥ Bonding.graduationThresholdUsd` (default `$12K`, owner-tunable via `setGraduationThresholdUsd`, bounded to `[$4K, $1M]`). **Supply:** all 750M curve tokens sold (flat/bear markets). |
| Dynamic LP seeding | `tokensForLP = raisedLT × reserve0 / reserve1`. Guarantees LP opens at the exact last curve price (zero-gap). Excess of `LP_RESERVE` burned. |
| Overflow buy protection | A buy that would exceed remaining real supply is capped; unused LT refunded (as USDC) to the buyer. |
| User-facing currency | USDC in / USDC out. LT fully abstracted. |
| Post-grad venue | HyperSwap V2 |
| Post-grad pair | TOKEN/LT (leveraged exposure persists) |
| LP handling | Locked in `LPLock.sol` (UUPS upgradeable, no withdraw in v1) |
| Leverage options | 2x, 3x, 5x (5x gets vol decay warning) |
| Wallet | Privy (social login, embedded wallets, WalletConnect) |

## Fees

Fees are charged by `Zap` in USDC on every buy/sell — curve **and** post-graduation — and forwarded to the dedicated `FeeVault` contract. Creators and the protocol each claim their pooled USDC balance directly from the vault; the router holds no fee state, so it can be upgraded/swapped without affecting outstanding balances (the vault keeps a depositor allowlist).

| Fee | Rate | Split | Charged where |
|---|---|---|---|
| Router buy | 0.5% | 0.4% protocol / 0.1% creator | `Zap` (USDC → `FeeVault`) |
| Router sell | 0.5% | 0.4% protocol / 0.1% creator | `Zap` (USDC → `FeeVault`) |
| HyperSwap swap (post-grad) | 0.3% | HyperSwap LPs (Alt Fun takes 0%) | HyperSwap V2 pair |
| LT redemption | BounceTech internal | No additional Alt Fun fee | BounceTech LT |

---

## Token Lifecycle

**Phase 1 — Bonding Curve:** Creator picks name, image, LT pair. Buys/sells go through Zap. Curve reserve is LT. Pair holds virtual `reserve0 = totalSupply` and 750M real tokens (25% is held back in `Bonding` as `lpReserve` for graduation).

**Phase 2 — Graduation (dynamic LP seeding):** Either trigger fires → unsold real tokens burned from the pair → all real LT drained → `tokensForLP = raisedLT × reserve0 / reserve1` is computed (the exact amount that makes the LP open at the last curve price) → remainder of the 250M `lpReserve` is burned → `addLiquidity()` on HyperSwap with `(tokensForLP, raisedLT)` → LP locked → curve closed. Strict invariants (zero-gap, supply conservation, parabola cap) are enforced in `test/GraduationInvariants.t.sol`.

**Phase 3 — Open Trading:** TOKEN/LT pool on HyperSwap. All trades still go through Zap (USDC in/out).

---

## Token Creation Flow (Two-Phase)

Creating a token is a **two-phase process**. Both phases must succeed for the token to appear in the UI.

### Phase 1 — On-Chain

Frontend calls `Zap.createToken(LaunchParams, seedUsdcAmount)`. This deploys the Token clone, creates the bonding curve pair via `Bonding.launch()`, and — if `seedUsdcAmount > 0` — performs the seed buy via the standard `Zap.buy` path (so it inherits the same pro-rata fee handling and leftover-LT-to-USDC refund as any other buy). Three key events fire: `TokenLaunched` (Bonding), `TokenCreated` (Zap), and `Buy` (Zap, only when seeded). The frontend parses `TokenCreated` from the receipt to extract the new token address.

### Phase 2 — Off-Chain API Registration

Frontend calls `POST /api/v1/tokens` with token metadata (name, ticker, description, image URL, LT address, social links) signed by the creator's wallet. This inserts a row into PostgreSQL. Without this step, the token exists on-chain but is invisible in the UI.

**Critical:** The home page token list (`GET /api/v1/tokens`) reads **exclusively from PostgreSQL**. Ponder (the indexer) only enriches individual token detail views with on-chain curve state (supply, reserves, graduation status). If the API registration fails, the token will not appear anywhere in the frontend.

### Field Semantics

| Field | Stores | Example |
|---|---|---|
| `ltPair` | LT **contract address** (not the symbol) | `0x1234…abcd` |
| `underlying` | Underlying asset symbol | `HYPE`, `ETH`, `BTC`, `SOL` |
| `ltDirection` | Long or short | `long`, `short` |
| `leverage` | Leverage multiplier | `2`, `3`, `5` |

### Signing

Off-chain writes (token creation, comments, profile updates) require a wallet signature. The message is built with `buildTokenCreationMessage()` from `@launchpad/shared`. Both the frontend and API use the same function to ensure message parity. The API verifies `recoverMessageAddress(message, signature) === creator`.

---

## Data Sources

| UI Location | Primary Source | Enrichment |
|---|---|---|
| Home page token list | PostgreSQL (`GET /api/v1/tokens`) | Ponder (curve state merged client-side) |
| Token detail page | PostgreSQL (`GET /api/v1/tokens/:address`) | Ponder (curve supply, LT reserve, graduation) |
| Trade history | Ponder (`trades` GraphQL, from `Bonding.Trade` events) | — |
| Holders | On-chain RPC (`balanceOf` multicall) | — |
| Asset prices | Hyperliquid API | — |

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

Key endpoints used by Alt Fun:

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

Our own contract addresses (`Zap`, `Bonding`, `Factory`, `Router`, `LPLock`, `FeeVault`) live in `packages/shared/src/constants/addresses.ts` and are regenerated on every deploy via `forge script` + `npm run export-abi`. Full deploy procedure (including the HyperEVM big-blocks gotcha that will silently break a fresh deploy): see [`packages/contracts/AGENTS.md`](packages/contracts/AGENTS.md#deploying-to-hyperevm).

### Infrastructure

| Service | Provider | Details |
|---|---|---|
| Database | Neon (PostgreSQL) | Direct connection (no Hyperdrive) |
| Image storage | Cloudflare R2 | Bucket: `launchpad-images`, served via Worker |
| WebSocket | Cloudflare Durable Objects | Real-time feeds. Channels: `trade`, `price`, `graduation`, `newToken`, `stats` |
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

## Admin Authentication

Admin endpoints (`/admin/*`) are authenticated via a shared admin API key passed in the `X-Admin-Key` header. The key is stored as a Cloudflare Worker secret (`ADMIN_API_KEY`). This is a simple v1 approach — wallet-based admin auth can be added later.

## Referrals

v1 tracks referrals only (no on-chain fee split). The `buy()` function accepts a `referrer` address parameter. `Referred` events are emitted and indexed for analytics. Payouts are deferred to v2.

## Open Tasks

See `TODO.md` in the repo root for outstanding work items. This is the single source of truth for open tasks. When completing a task, remove it from `TODO.md`. When discovering new work, add it there.
