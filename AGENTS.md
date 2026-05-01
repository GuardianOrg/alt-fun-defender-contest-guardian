# Alt Fun

Token launchpad on HyperEVM. Every token's bonding curve holds a BounceTech Leveraged Token (LT) as its reserve asset. Tokens appreciate from buy pressure AND leveraged movement of the underlying.

---

## How It Works

1. **Create:** Creator picks an underlying asset + leverage (e.g. HYPE 2x Long) and launches a token
2. **Buy:** User sends USDC → Router mints LT → LT enters bonding curve → user gets tokens
3. **Sell:** User sends tokens → Router sells on curve → redeems LT → user gets USDC
4. **Graduate:** Dual trigger — curve closes when **either** `raisedLT × exchangeRate ≥ Bonding.graduationThresholdUsd` (`$12K` in production, set once at `Bonding.initialize` and immutable thereafter — changing it requires a UUPS upgrade with a `reinitializer`) **or** all 750M curve tokens sold. LP is seeded with exactly the tokens needed to match the last curve price ("dynamic LP seeding" → zero price gap between curve and DEX). Excess LP-reserve tokens and any unsold curve tokens are burned. LP is locked.
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
| Graduation market cap | `~$16K` at launch-time rate when threshold = `$12K` (higher when LT rallies). `graduationThresholdUsd` is set at `Bonding.initialize` and only changeable via a UUPS upgrade with a `reinitializer`. |
| Graduation triggers (dual) | **USD:** `raisedLT × exchangeRate ≥ Bonding.graduationThresholdUsd` (`$12K` in production, set once at `Bonding.initialize` and immutable thereafter — changing it requires a UUPS upgrade with a `reinitializer`). **Supply:** all 750M curve tokens sold (flat/bear markets). |
| Dynamic LP seeding | `tokensForLP = raisedLT × reserve0 / reserve1`. Guarantees LP opens at the exact last curve price (zero-gap). Excess of `LP_RESERVE` burned. |
| Overflow buy protection | A buy that would exceed remaining real supply is capped; unused LT refunded (as USDC) to the buyer. |
| User-facing currency | USDC in / USDC out. LT fully abstracted. |
| Post-grad venue | HyperSwap V2 |
| Post-grad pair | TOKEN/LT (leveraged exposure persists) |
| LP handling | Locked in `LPLock.sol` (UUPS upgradeable, no withdraw in v1) |
| Leverage options | 2x, 3x, 5x (5x gets vol decay warning) |
| Wallet | Privy (social login, embedded wallets, WalletConnect) |

## Fees

Fees are charged by `Zap` in USDC on every buy/sell — curve **and** post-graduation — and forwarded to the dedicated `FeeVault` contract. Creators and the protocol each claim their pooled USDC balance directly from the vault; `Zap` (the user-facing router) holds no fee state, so it can be upgraded or swapped via the `Bonding._routers` allowlist without affecting outstanding balances (the vault keeps a depositor allowlist). This "hot-swap" applies only to the `Zap` layer — the internal AMM `Router.sol` is frozen at deploy time (see [`packages/contracts/AGENTS.md`](packages/contracts/AGENTS.md#two-router-concepts--read-this-before-touching-either)).

| Fee | Rate | Split | Charged where |
|---|---|---|---|
| Router buy | 0.5% | 0.4% protocol / 0.1% creator | `Zap` (USDC → `FeeVault`) |
| Router sell | 0.5% | 0.4% protocol / 0.1% creator | `Zap` (USDC → `FeeVault`) |
| HyperSwap swap (post-grad) | 0.3% | HyperSwap LPs (Alt Fun takes 0%) | HyperSwap V2 pair |
| LT redemption | BounceTech internal | No additional Alt Fun fee | BounceTech LT |

---

## Token Lifecycle

**Phase 1 — Bonding Curve:** Creator picks name, image, LT pair. Buys/sells go through Zap. Curve reserve is LT. Pair holds virtual `reserve0 = totalSupply` and 750M real tokens (25% is held back in `Bonding` as `lpReserve` for graduation).

**Phase 2 — Graduation (two-phase, dynamic LP seeding):** Split across two txs to fit HyperEVM's ~2M small-block gas ceiling:

- **Phase 1 (inline in the threshold-crossing buy):** unsold real tokens burned from the pair → all real LT drained → `tokensForLP = raisedLT × reserve0 / reserve1` is computed and cached → remainder of the 250M `lpReserve` is burned → `lifecycle: Curve → Graduating` flips, freezing trading. Emits `TokenGraduating`.
- **Phase 2 (`Bonding.finalizeGraduation`, permissionless):** create HyperSwap pair if needed → direct `pair.mint(lpLock)` with the cached amounts (router-bypass — brick-proof against front-runner dust seeding) → `lifecycle: Graduating → Graduated`. Emits `TokenGraduated`. A Cloudflare Worker keeper drives the happy path within ~60s; anyone can call to rescue stuck tokens.

Strict invariants (zero-gap, supply conservation, parabola cap) are enforced in `test/GraduationInvariants.t.sol`; phase-1 gas budget + brick resistance in `test/TwoPhaseGraduation.t.sol`.

**Phase 3 — Open Trading:** TOKEN/LT pool on HyperSwap. All trades still go through Zap (USDC in/out).

---

## Anti-snipe Design

The launch flow is gated by a two-knob anti-snipe mechanism (issue #310). First-block bots are the dominant retail-exit-liquidity drain on every pump.fun-class launchpad — these knobs eliminate the asymmetric extraction without changing the user-facing flow.

| Knob | Where | Value |
|---|---|---|
| Mandatory creator seed buy | `Zap.MIN_SEED_USDC` | `$20` (real USDC, 6dp) |
| Public-trading delay | `Bonding.LAUNCH_TRADING_DELAY_BLOCKS` | 3 blocks |

The combination is what works: the seed buy absorbs the bottom of the curve, and the 3-block delay stops anyone (sniper or retail) racing the seed at block N or piling in at N+1..N+3. Trading opens at `launchBlock + LAUNCH_TRADING_DELAY_BLOCKS + 1`. The seed buy itself bypasses the delay via a transient-storage flag set inside `Bonding.launch` and consumed by the very next `Bonding.buy` in the same tx — so the in-tx seed always lands while same-block sniper bundles (separate txs, transient cleared) revert with `TradingNotOpen`.

**No upper bound on the seed buy. This is intentional.** A cap is trivially bypassable (the same creator seeds via wallet A then snipes the open at block N+4 from wallet B), and some creators legitimately seed >50% of a curve and burn the result post-launch as a supply sink. The lower bound is the protective side; the upper bound would block useful patterns and provide no real defence. Auditors: this is a deliberate design decision, not an oversight. See the inline natspec on `Zap.MIN_SEED_USDC` and `Bonding._enforceLaunchDelay`.

**Pre-flight in the UI.** The frontend mirrors `MIN_SEED_USDC` so users can't construct a reverting tx — see [`apps/web/src/components/create/SeedBuy.tsx`](apps/web/src/components/create/SeedBuy.tsx) and the create-flow disable rule in [`apps/web/src/components/create/CreateView.tsx`](apps/web/src/components/create/CreateView.tsx).

## Token Creation Flow

A token is fully launched in **a single on-chain transaction**. The frontend then makes one address-only API call to register the token in PostgreSQL — no second wallet popup, no signed message. If that API call fails (closed tab, lost network, transient 5xx) a cron-driven backfill catches up within ~60s, so the user never has to retry by hand.

### Step 1 — Image upload (off-chain, pre-tx)

Before any wallet popup, the frontend uploads the token image via `POST /api/v1/images`. The Worker scans the image with our content-moderation pipeline (Workers AI today, replaceable with a third-party moderation service) and stores the file in R2 only if it passes. Returns a URL of the form `https://<api-host>/images/tokens/<uuid>-<name>`. A rejected image stops the flow before the wallet sees the launch tx.

### Step 2 — On-chain launch (single tx)

Frontend calls `Zap.createToken(LaunchParams, seedUsdcAmount)` (or `Zap.createTokenWithPermit(...)` when a USDC permit is bundled in for the seed buy). `seedUsdcAmount` is **mandatory** and must be at least `Zap.MIN_SEED_USDC` (= `$20`) — see *Anti-snipe Design* above. `LaunchParams.image` is the moderated R2 URL from step 1; `params.urls[0..2]` carries twitter / telegram / website. This deploys the Token clone, creates the bonding curve pair via `Bonding.launch()`, and performs the seed buy via the standard `Zap.buy` path. Three events fire: `TokenLaunched` (Bonding), `TokenCreated` (Zap), and `Buy` (Zap). The frontend parses `TokenCreated` from the receipt to extract the new token address.

`Bonding.launch` enforces metadata length caps (description ≤ 8KB, image ≤ 512B, each url ≤ 512B) on top of the existing name / ticker bounds. These are DoS guards — replicated off-chain so users get a clean validation error instead of a revert.

### Step 3 — Address-only registration (off-chain, post-tx)

Frontend calls `POST /api/v1/tokens` with `{ address }` only. The API reads `Bonding.getTokenInfo(address)` directly, validates that `info.image` either is empty or points at our R2 bucket (verified with an R2 HEAD), looks the LT up in the BounceTech directory to derive `underlying` / `ltDirection` / `leverage`, and inserts the row. **No signature** required: any caller for a given token address produces a byte-identical row, so a stranger calling this on someone else's freshly-launched token writes the same data the legitimate creator would. Idempotent at the DB layer — the cron backfill races the frontend harmlessly.

The frontend `await`s this so the UI spinner stays up until the row is queryable; on failure the user sees "indexing is delayed, will appear within a minute" rather than an actionable retry button.

### Step 4 — Cron backfill (safety net)

The API Worker's `scheduled()` handler (1-minute cadence) sweeps Ponder for the most recently-launched tokens and registers any not yet in PostgreSQL. Same code path as the synchronous registration endpoint, so cron-driven and frontend-driven inserts are indistinguishable. See `apps/api/src/lib/registration-backfill.ts`.

**Why the home page list still reads from PostgreSQL:** the home page is `GET /api/v1/tokens`, which serves filterable / paginatable / sortable queries that the indexer's GraphQL doesn't optimise for. Ponder enriches individual token detail views with on-chain curve state (supply, reserves, graduation status); the DB row carries the off-chain-derived fields (`underlying`, `ltDirection`, etc.) that the home page filters on.

### Field Semantics

| Field | Stores | Example |
|---|---|---|
| `ltPair` | LT **contract address** (not the symbol) | `0x1234…abcd` |
| `underlying` | Underlying asset symbol | `HYPE`, `ETH`, `BTC`, `SOL` |
| `ltDirection` | Long or short | `long`, `short` |
| `leverage` | Leverage multiplier | `2`, `3`, `5` |

### Signing (other off-chain writes)

Other off-chain writes — comments, profile updates — still require a wallet signature, but they reuse the 24-hour session signature flow (`buildSessionMessage` + `useSessionSignature`) so users sign **once per day, not per action**. Token creation does not participate in this — the on-chain `TokenInfo` is sufficient proof, so no signed message is needed at all.

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

### Documentation

- [BounceTech docs](https://docs.bounce.tech/) — protocol overview, fees, leverage mechanics
- [BounceTech integration guide](https://docs.bounce.tech/technical/integration-guide) — contract views, mint/redeem flow, atomic vs. async redemption
- [`bounce-tech/bounce-smart-contracts`](https://github.com/bounce-tech/bounce-smart-contracts) — canonical Solidity source if you need to read past the interface summarised below

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
