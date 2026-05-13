# apps/telegram-bot

Telegram trading bot for Alt Fun. Users buy/sell tokens on HyperEVM bonding curves and post-grad HyperSwap pools, manage custodial wallets, and view positions — all from Telegram chat.

**v1 scope is intentionally narrow:** features that would require new endpoints in `apps/api` (snipe orders, copy-trade rules, limit/DCA orders, price/graduation alert subscriptions, wallet tracking) are **deferred**. The bot ships only what the existing `apps/api` surface (extended with the bot-router endpoints below) and direct HyperEVM RPC already support. When `apps/api` adds further endpoints, the matching command lands in a follow-up — see *Deferred features* near the end of this doc.

## Architecture

```
apps/telegram-bot/       — grammY bot, Cloudflare Workers runtime (webhook mode)
  src/
    bot.ts               — Bot instance, middleware stack, command/callback registration
    commands/            — One file per command (/buy, /sell, /wallet, …)
    scenes/              — Multi-step wizard flows (wallet import, withdraw)
    keyboards/           — Inline keyboard builders
    lib/
      wallet.ts          — Custodial key management (encrypted at rest in KV)
      trade.ts           — Trade intent construction, RPC submission
      session.ts         — Per-user session state (active wallet, pending intents)
      pin.ts             — PIN hash/verify, brute-force lockout
      format.ts          — Token cards, signed-number formatting, MarkdownV2 escaper + md template tag
      chart.ts           — Chart image renderer (SVG via lightweight builder → PNG via resvg-wasm)
    api.ts               — Typed wrapper around apps/api REST endpoints
    rpc.ts               — RpcClient class (HyperEVM RPC, tx submission)
    chat-do.ts           — ChatDO (Durable Object that serialises grammY updates per chat; gives per-user serialisation for /start because /start is private-DM only, so chatId == userId)
```

Data flow: Telegram webhook → Cloudflare Worker → command handler → `api.ts` (reads Alt Fun API + Ponder) or `rpc.ts` (on-chain reads/writes) → formatted reply.

Custodial wallets: private keys encrypted with AES-256-GCM using a per-user key derived from `MASTER_KEY` + `userId`. Stored in Cloudflare KV. PIN is required before any key exposure or withdrawal. This is the standard Telegram trading bot model (Bonkbot, Trojan, etc.) — non-custodial is a future option via WalletConnect deep-link.

Integration: all off-chain data comes from `apps/api` (token list, trades, portfolio, prices). On-chain writes (buy/sell/withdraw) are signed by the custodial key and submitted via `rpc.ts` directly to HyperEVM. The bot does **not** run keepers, broadcast queues, or persistent order books in v1 — those land when `apps/api` exposes the corresponding endpoints (see *Deferred features*).

See [apps/api/AGENTS.md](../api/AGENTS.md) for the REST endpoints this bot consumes. See [root AGENTS.md](../../AGENTS.md) for token lifecycle, fee model, and contract addresses.

---

## API surface consumed from apps/api

The bot consumes the endpoints `apps/api` exposes today, plus three new bot-namespaced endpoints introduced for the bot fee model (see *Bot Fee Model* below).

| Endpoint | Bot usage |
|---|---|
| `GET /api/v1/tokens/:addr` | Token card on `/buy`, `/sell`, `/track` — name, mcap, `curveFilled`, `curveFilledOrganic`, `curveFilledLeverageBoost`. Mirrors the web row exactly. |
| `GET /api/v1/chart/:address` | Candle snapshot for `lib/chart.ts` — returns `candles[]`, `currentRatio`, `currentExchangeRate`. **Canonical chart endpoint shared with the web app's `fetchChart` in `apps/web/src/services/api.ts`.** The older `/trades/ohlcv/:address` route also exists but does not return `currentRatio` / `currentExchangeRate`, which are required for the in-progress candle to track the live LT rate; use `/chart` everywhere. |
| `GET /api/v1/trades/:address` | Per-token trade history for `/track <contract>` (last N trades). |
| `GET /api/v1/bot/positions/:wallet` | **Bot-only.** Open + realised positions for `/positions`, sourced from `walletBotPosition` (driven by `BotRouterTrade` events). Includes cost basis, current value, unrealised PnL, realised PnL — see *Bot Fee Model → New `apps/api` endpoints*. |
| `GET /api/v1/balances/:wallet` | **Indexed Alt Fun token balances only** — returns `{address, name, ticker, ltPair, leverage, balance, …}` per held token. Does *not* return native HYPE or USDC. For HYPE / USDC the bot reads `balanceOf` directly via `rpc.ts` (multicall) — see `/wallet` balance display. |
| `GET /api/v1/bot/referrals/:wallet` | **Bot-only.** Referred count, lifetime earned, current rewards wallet for `/referral`, sourced from `referrerStats` and KV. |
| `POST /api/v1/bot/referrals/:wallet/rewards-wallet` | **Bot-only.** Updates the user's rewards-wallet KV record. Does not touch on-chain attribution — see /referral → Rewards wallet. |
| `GET /api/v1/stats` | Platform stats for `/help` and ambient context. |

**No WebSocket consumption in v1.** Live `trade` / `price` / `graduation` / `newToken` feeds would only be useful for snipe / copy-trade / alert features, all of which are deferred. The bot is purely request/response.

**Auth model — bot uses a dedicated API key, not a magic internal secret.** `apps/api` applies `apiKeyAuth` middleware to every `/api/v1/*` route (see `apps/api/src/index.ts` `app.use("/api/v1/*", apiKeyAuth)` and `apps/api/src/middleware/api-key-auth.ts`). The middleware understands exactly one auth header — `X-API-Key`, validated against the `apiKeys` table. There is **no** `API_INTERNAL_SECRET` short-circuit and **no** service-binding bypass: requests over a service binding land on the same fetch handler with the same middleware as public traffic, and `CF-Connecting-IP` resolves to the bot Worker's egress identity rather than the end user's. If the bot sends no `X-API-Key`, it gets bucketed under the anonymous per-IP ceiling (240/min) keyed on that single Worker IP — every user shares one bucket and the bot starves itself within a few concurrent commands. Provision one dedicated `apiKeys` row for the bot (rate-limit sized for fleet aggregate, not per-user) and ship the value as a Worker secret. Treat the binding as a latency optimisation, not an auth bypass. If a write surface ever lands (deferred features), it must be a real authenticated route on `apps/api` keyed on `(apiKey, wallet)`, not an `X-Bot-Internal` shared secret.

**Service binding scope.** The bot binds to `apps/api` for zero-egress latency on every read above. The binding does not change auth or rate limiting — every bound call still hits `apiKeyAuth` and counts against the bot's `X-API-Key` quota. It **does** bypass the Cloudflare edge cache (bound traffic lands directly on the api's fetch handler, never on a CDN colo), so the 15–30 s `s-maxage` on aggregate routes does nothing for the bot — assume each bound call costs one full Worker invocation on the api side and rely on the indexer-side O(1) counters rather than edge caching for latency.

---

## Bot Fee Model

The bot is operated by an external team that charges its own fee on top of Alt Fun's 0.5% protocol fee. All trades route through a bot-team-owned `BotFeeRouter` contract, which skims the bot fee and forwards the remainder to Alt Fun's `Zap`. **The bot never calls `Zap.buy` / `Zap.sell` directly.**

### Parameters (immutable in deployed router)

| Parameter | Value |
|---|---|
| `botFeeBps` | `50` — 0.5% on buy, 0.5% on sell, flat. Charged on USDC notional both directions. |
| `referrerShareBps` | `2_000` — 20% of `botFee` to the referrer's rewards wallet, 80% to treasury. |
| `treasury` | Single-key cold wallet address. Baked into the router constructor — not settable post-deploy. |
| Governance | None. To change `botFeeBps`, `referrerShareBps`, or `treasury`, deploy a new router and update the bot's `BOT_FEE_ROUTER_ADDRESS` secret. No admin key, no upgrade proxy. |

### Buy flow

```
buyWithBotFee(token, usdcAmount, minTokensOut, referrer):
  1. transferFrom(user → router, usdcAmount)
  2. botFee = usdcAmount * botFeeBps / 10_000
  3. if referrer != address(0):
       referrerCut = botFee * referrerShareBps / 10_000
       ok = USDC.transfer(referrer, referrerCut)
       if !ok:
         referrerCut = 0          // bad-referrer-wallet fallback — see below
       else:
         emit ReferralPaid(referrer, user, referrerCut, token, side='buy')
       treasuryCut = botFee - referrerCut
     else:
       treasuryCut = botFee
  4. USDC.transfer(treasury, treasuryCut)
  5. USDC.approve(Zap, usdcAmount - botFee)
  6. tokensOut = Zap.buy(token, usdcAmount - botFee, minTokensOut, address(0))
  7. ERC20(token).transfer(user, tokensOut)
  8. emit BotRouterTrade(user, token, 'buy', usdcAmount, tokensOut, botFee, referrer, referrerCut, treasuryCut)
```

Permit variant (`buyWithBotFeePermit`) takes the user's `Permit` signature and replaces step 1's `transferFrom` with a permit-then-transferFrom flow — same downstream logic.

### Sell flow

Symmetric. Pull tokens from user, call `Zap.sell` with `address(0)` as referralCode, take `botFeeBps` out of the returned USDC, split between treasury and referrer with the same fallback rule, forward the remaining USDC to the user. Bot fee on sells is paid in USDC out, not in tokens in.

### Why a router (not direct Zap calls)

The router exists exclusively to (a) charge the bot operator fee and (b) settle the referral split on-chain at trade time. It does not modify Alt Fun's curve mechanics, slippage protection, post-graduation routing, or graduation logic — those still happen inside `Zap` and the underlying contracts. The router is intentionally minimal: pull, skim, split, forward.

### Why no claim / withdraw flow

Referrer cuts settle on-chain to the referrer's rewards wallet in the same tx as the trade. There is no off-chain ledger, no treasury hot wallet, no payout queue, and no `claim()` button. The treasury is cold-wallet-only and never needs to sign anything for routine operation — funds arrive at the cold address directly from the router on every trade. This was the explicit constraint that drove the architecture: **the cold wallet must never be required to sign for payouts.**

### Bad-referrer-wallet fallback

If a referrer's rewards wallet rejects the USDC transfer (contract without `receive`/`fallback` for the token, frozen address, etc.), `USDC.transfer` returns false. The router treats that as `referrerCut = 0` and rolls the entire `botFee` into the treasury cut rather than reverting the trade. **A referrer's misconfigured wallet must never block trades by users they referred.**

The bot surfaces this in `/referral` if it's detected (the indexer can compare attributed-trades count against successful `ReferralPaid` events) so the referrer knows to fix their rewards wallet.

### Self-referral

Allowed. No router-side guard. A self-referring user effectively pays a 0.4% bot fee instead of 0.5%, which is fine — that's the same behaviour as any other referred user, just with referrer = trader.

### Alt Fun referrer slot

Always passed as `address(0)`. The bot does not participate in Alt Fun's wallet-keyed referrer system. The web app's `?ref=<wallet>` deeplinks are out of scope for the bot. There is no mapping from Telegram userId to Alt Fun referrer wallet anywhere in the bot.

### Indexer requirements

The shared Ponder indexer (Alt Fun's, extended for the bot team) must add subscriptions to `BotFeeRouter` events and the entities below. None of this lives in bot KV — KV stores only session state and the per-user `rewardsWallet` mapping.

```
botRouterTrade {
  txHash, blockNumber, timestamp,
  trader,             // user wallet that signed the trade
  token,              // traded token
  side,               // 'buy' | 'sell'
  usdcAmount,         // gross USDC for buy / gross USDC out for sell, before bot fee
  tokenAmount,        // tokens received (buy) or sold (sell)
  botFee,             // bot fee paid in USDC
  referrer,           // referrer wallet or address(0)
  referrerCut,        // 0 if no referrer or transfer failed
  treasuryCut         // botFee - referrerCut
}

walletBotPosition {  // analogue of walletPosition; one row per (wallet, token)
  wallet, token,
  costBasisUsdc,     // sum of (usdcAmount on buys) for currently-held tokens
  tokenBalance,      // tokens held (cleared to 0 when fully sold)
  realisedPnlUsdc,   // running sum of (proceeds - cost) for closed-out chunks
  totalCostUsdc,     // lifetime sum of buy notional
  totalProceedsUsdc  // lifetime sum of sell notional
}

referrerStats {  // one row per referrer wallet
  referrer,
  referredCount,     // distinct trader wallets attributed to this referrer
  lifetimeEarnedUsdc // sum of all ReferralPaid amounts (transfer-confirmed only)
}
```

Cost basis on every buy and proceeds on every sell are read from the router's own event, so the bot fee is automatically included in user-visible PnL. Realised PnL uses average-cost accounting for partial sells (same model as the existing `walletPosition`).

### New `apps/api` endpoints

The shared API exposes three new endpoints for the bot. All key on wallet, all return JSON, all sit behind the existing `apiKeyAuth` middleware.

| Endpoint | Returns |
|---|---|
| `GET /api/v1/bot/positions/:wallet` | `{ open: [{ token, ticker, balance, costBasisUsdc, currentValueUsdc, unrealisedPnlUsdc, unrealisedPnlPct }], realised: [{ token, ticker, totalCostUsdc, totalProceedsUsdc, realisedPnlUsdc, realisedPnlPct }] }` — driven by `walletBotPosition`. |
| `GET /api/v1/bot/referrals/:wallet` | `{ referredCount, lifetimeEarnedUsdc, rewardsWallet }` — driven by `referrerStats` plus the rewards-wallet KV record. |
| `POST /api/v1/bot/referrals/:wallet/rewards-wallet` | Body `{ rewardsWallet }`. Updates the bot's KV mapping. **Does not touch on-chain attribution** — past referred users keep paying out to the previously-set wallet only if they retrade after the change; the change applies only to attributions where `ReferralPaid.referrer == newRewardsWallet`. See *Rewards wallet semantics* in `/referral`. |

### Secrets

| Secret | Purpose |
|---|---|
| `BOT_FEE_ROUTER_ADDRESS` | Deployed `BotFeeRouter` contract address. Rotated by deploying a new router and pushing the new address. |

---

## Commands

| Command | Purpose | Auth required |
|---|---|---|
| `/start` | Onboard user, create wallet | None |
| `/help` | Command list + security guidance | None |
| `/wallet` | Manage wallets (create/import/switch/export) | PIN for export |
| `/buy <contract> [amount] [slippage]` | Buy token | PIN if confirmations on |
| `/sell <contract_or_symbol> [%\|amount]` | Sell position | PIN if confirmations on |
| `/positions [wallet]` | Open positions (balance + cost basis) | None |
| `/track <contract>` | Show token info card + recent trades | None |
| `/withdraw <asset> <amount> <address>` | Withdraw to external wallet | PIN + confirm |
| `/settings` | Bot defaults (slippage, buy amount, MEV, etc.) | None |
| `/security` | PIN, sessions, anti-phishing, withdrawal locks | PIN for changes |
| `/referral` | Referral link, referred count, earned volume | None |

---

## Command Specifications

### /start

```
Input:   none (optional deeplink parameter for referral)
Output:  welcome message, risk disclaimer, create-or-import wallet prompt, main menu buttons
Effects: create user profile in KV if missing; record referrer if deeplink present;
         write default rewardsWallet (= active custodial wallet address) into KV
```

Referral deeplink: `t.me/<botname>?start=ref_<referrerUsername>` is what `/referral` now issues for any sharer with a Telegram username set, and `t.me/<botname>?start=ref_<referrerUserId>` is the fallback the sharer's `/referral` view falls back to when no Telegram username is available (username is optional in Telegram). Record referrer on first `/start` only — subsequent `/start` calls for existing users must not overwrite the referrer.

**Referrer resolution.** The deeplink param may be either a Telegram username or a numeric userId. The `/start` handler resolves either to the referrer's `rewardsWallet` (the username-keyed lookup requires a `username → userId` mapping written by every `/start`; the numeric form maps userId → wallet directly) and stores **the resolved wallet address** as the new user's `referrer` in KV — never the userId or username. That stored wallet is the address passed to `BotFeeRouter.buyWithBotFee` / `sellWithBotFee` on every subsequent trade by this user, making attribution lifetime by construction. See /referral → Referrer attribution for edge cases (referrer not yet onboarded, self-referral, no retro-link).

**Default rewards wallet.** On first /start, the bot writes `rewardsWallet = activeCustodialWalletAddress` into KV unconditionally (whether or not the user came in via a deeplink). This guarantees /referral always has a rewards wallet to display, and that referrals from this user start paying out from their first referred trade.

**Strong consistency via `ChatDO`.** Profile creation, referrer recording, and rewards-wallet defaulting all happen inside the `/start` handler, which runs on `ChatDO` (one DO instance per `chat:${chatId}`, named via `idFromName`) — not on the raw Worker isolate. Cloudflare KV is eventually consistent: under concurrent `/start` spam, a raw KV `get-then-put` can double-create profiles or double-record referrers. `ChatDO`'s single-threaded event loop serialises every update for a given chat, so the read-modify-write becomes atomic from the handler's perspective. `/start` is private-DM only (the handler rejects non-private chats), and in private DMs Telegram's `chat.id` equals the user's `from.id`, so per-chat serialisation is per-user serialisation for this command. This is the same single-threaded-DO pattern as `WsIpLimiter` in `apps/api`; an explicit per-user `OnboardingDO` was considered and rejected as redundant given the private-DM invariant.

### /help

```
Input:   optional topic (e.g. /help wallet, /help withdraw)
Output:  command list, common flows, support links, security warnings
```

Always include the anti-phishing reminder: "This bot will never ask for your seed phrase or private key via DM."

### /wallet

Actions accessible via inline keyboard after `/wallet`:

| Action | Description | Security gate |
|---|---|---|
| Create wallet | Generate new keypair, encrypt, store in KV | None |
| Import wallet | Wizard accepts private key or mnemonic via DM; message deleted immediately after read. Prominent "Import from Web App" label guides users who already have a Privy wallet to paste their exported key here. | None |
| Switch wallet | Select from list of saved wallets | None |
| Rename wallet | Set a label for the active wallet | None |
| Export private key | Show plaintext key in ephemeral message (auto-delete 30s) | PIN + explicit warning |
| Delete wallet | Remove from index + KV; reassigns active if needed | PIN + confirm |
| Withdraw | Alias to `/withdraw` flow | PIN + confirm |

Balance display: native HYPE and USDC are read via `rpc.ts` multicall (`eth_getBalance` + `USDC.balanceOf`) — they are **not** in `GET /api/v1/balances/:wallet`, which returns indexed Alt Fun token balances only. Render native HYPE (RPC) + USDC (RPC) + token positions (`/balances` enriches with `name` / `ticker` / `ltPair`).

**Multi-wallet model (Trojan-style).** Users may hold up to `MAX_WALLETS_PER_USER = 10` wallets per Telegram account. One wallet is always *active* (when at least one exists); buy / sell / withdraw use the active wallet as the implicit signer. Modelled after [Trojan's wallets UX](https://docs.trojan.app/telegram-bot-user-guide/settings/wallets), rejected BONKbot's one-wallet-per-account model because the AGENTS.md actions list already commits to Switch + Rename.

**KV schema** (namespace `WALLET_KV`):

| Key | Value | Purpose |
|---|---|---|
| `wallet:<userId>:<walletId>` | `StoredWallet` JSON (`{ id, address, encryptedKey, label?, createdAt }`) | Per-wallet record. Encrypted material lives only here. |
| `wallet:<userId>:index` | `WalletIndex` JSON (`{ wallets: string[], active: string \| null }`) | Ordered walletId list + active pointer. Renders `/wallet` in one read. |

Chosen over `KV.list({prefix})` because list is unordered, paginated, and one op per scan — the index is O(1) and gives a single mutation point for create / delete / reorder.

**`walletId` scheme.** Short opaque ids: `w_` + 6 Crockford base32 chars (e.g. `w_3kfq8a`). Total length 8. Picked deliberately:
- Positional ids (`1`, `2`, …) renumber after delete and break bookmarked `callback_data`.
- UUIDs eat the 64-byte `callback_data` budget once combined with action codes (`s:w_3kfq8a:100` fits; `s:550e8400-…:100` does not).

**Active pointer semantics.**
- First `Create` or `Import` → that wallet becomes active automatically.
- `Switch` updates `index.active`; no record moves.
- `Delete` reassigns `active` to `wallets[0]` post-removal, or `null` if the deleted wallet was the last.
- `Rename` mutates only the record's `label`; never touches the index.

**Concurrency.** Not handled directly here. KV gives strong per-key consistency on the index, but cross-key writes (record + index on Create) are not transactional. In practice the WAR window is closed by `ChatDO` — `/wallet` is private-DM only, every update for the chat lands on the same DO event loop, and chatId == userId in private DMs — so a single user running two parallel mutations from two clients still flows through one serialised handler. The cross-client race only re-opens if `/wallet` is ever allowed outside private DMs, in which case the handler needs an explicit per-user DO.

**Crypto.** Private keys are encrypted with AES-256-GCM under a per-user key derived from `MASTER_KEY` + userId via HKDF-SHA256 — see `lib/wallet.ts`. The master key never touches KV, and one user's ciphertext leak cannot be decrypted under another user's derivation. Rotating `MASTER_KEY` invalidates every stored wallet; there is no re-encryption migration in v1.

### /buy

```
Input:
  required: <contract_address> or alt.fun URL
  optional: <amount_in_usdc>, slippage=<bps>, priority=<gwei>

Output:
  - Static chart image (24h candles, rendered via lib/chart.ts from GET /api/v1/chart/:address, sent as Telegram photo)
  - Token card caption (name, ticker, mcap, curve fill %, 24h change, leverage boost indicator)
  - Risk summary (leverage level, vol decay warning if 5x LT)
  - Fee summary line: "Bot fee 0.5% + Alt Fun fee 0.5%". If a referrer is registered for the user, append "(0.1% goes to your referrer)".
  - Quick-amount buttons: $20 | $50 | $100 | Custom
  - Confirm button (if confirmations enabled in /settings)

Effects (after confirmation):
  - Check user USDC balance ≥ (buy amount + gas estimate); surface "Insufficient USDC" if not
  - Resolve USDC allowance for `BotFeeRouter` (NOT Zap directly):
      • If allowance < amount and USDC supports EIP-2612 permit, sign a permit
        for the router and route through `BotFeeRouter.buyWithBotFeePermit`.
      • Otherwise submit `approve(BotFeeRouter, maxUint256)` first, then route
        through `BotFeeRouter.buyWithBotFee`. Same fallback ladder as web's
        `useTradeRouter.executeBuy`, just with the router as approval target.
  - Derive slippage bound: simulate `BotFeeRouter.buyWithBotFee[Permit]`
    with `minTokensOut = 0` to get `quotedTokensOut`. The simulation already
    accounts for the bot fee (router skims `botFeeBps` before forwarding to Zap),
    so `quotedTokensOut` is the post-bot-fee token amount the user actually receives.
    Compute `minTokensOut = quotedTokensOut * (10_000 - slippageBps) / 10_000` and
    submit the real tx with that bound. **Never simulate Zap directly and never
    submit with `minTokensOut = 0` — both reopen the sandwich window the bound
    exists to close.**
  - Pass the user's stored `referrer` (or `address(0)` if none) as the
    `referrer` arg. Lifetime attribution is enforced by the bot writing the
    referrer once at /start — see /referral and Bot Fee Model.
  - Estimate gas via `estimateContractGas` and submit with a 1.3× buffer.
  - Show tx hash + explorer link. On receipt, the indexer's `BotRouterTrade`
    event drives the next /positions read; do not maintain a parallel KV cache.

Failure modes specific to buys:
  - LT mint-paused: `Zap.buy` reverts inside the router, the router surfaces the inner revert. Surface to user: "Buys paused for this token — BounceTech LT is temporarily mint-paused. Sells still work." Do not surface the raw revert.
  - Slippage exceeded: "Price moved — try again or increase slippage in /settings."
  - Minimum buy not met: surface before tx construction, not after revert.
  - Bad referrer wallet: NOT a user-visible error. The router's bad-referrer-wallet fallback rolls the cut into treasury and the trade still settles. The referrer (a different user) sees a banner in their /referral the next time they open it.
```

Token card format mirrors the web UI: name · ticker · mcap · curve-fill bar · leverage tag.

Slippage default: from `/settings` (default 1%). Priority fee default: from `/settings`.

**Minimum buy: `MIN_USDC_BUY_AMOUNT` from `@launchpad/shared` (currently $20 USDC)** — enforced client-side before tx construction. Note this is the **gross** USDC amount the user spends, not the net after bot fee — the existing constant is correct because the post-bot-fee amount forwarded to Zap is `usdcAmount × 0.995`, still well above BounceTech's $10 LT floor for $20 in. Import the constant; do not hardcode. Quick-amount buttons start at the minimum (currently $20). Surface error: `` md`Minimum buy is $${MIN_USDC_BUY_AMOUNT} USDC` ``.

### /sell

```
Input:
  required: <contract_address> or <ticker_symbol>
  optional: <percentage>% or <amount_in_tokens>  (default: show picker)

Output:
  - Position summary (token amount, cost basis from /api/v1/bot/positions)
  - Estimated USDC out from simulation (post all fees: Alt Fun 0.5% + HyperSwap LP fee post-grad + bot 0.5%)
  - Fee summary line: "Bot fee 0.5% + Alt Fun fee 0.5%". If a referrer is registered, append "(0.1% goes to your referrer)".
  - Quick-sell buttons: 25% | 50% | 75% | 100% | Custom
  - Confirm button (if confirmations enabled)

Effects:
  - Check baseAssetBalance() ≥ sell value; cap and warn if buffer low (buffer check still applies — the router calls Zap.sell, which is what hits the buffer)
  - Resolve token allowance for `BotFeeRouter` (NOT Zap directly):
      • If allowance < amount and token supports EIP-2612 permit, sign permit
        for the router and route through `BotFeeRouter.sellWithBotFeePermit`.
      • Otherwise submit `approve(BotFeeRouter, maxUint256)` then route through
        `BotFeeRouter.sellWithBotFee`.
  - Derive slippage bound: simulate `BotFeeRouter.sellWithBotFee[Permit]` with
    `minUsdcOut = 0` to get `quotedUsdcOut`. The simulation accounts for the bot
    fee (router skims after Zap returns), so `quotedUsdcOut` is the post-bot-fee
    USDC the user actually receives. Compute
    `minUsdcOut = quotedUsdcOut * (10_000 - slippageBps) / 10_000`,
    **then floor at 1 wei** when `quotedUsdcOut > 0` and slippage rounding would
    drop the bound to zero — passing 0 reopens the unconstrained-execution window
    the bound exists to close. Note `minUsdcOut` is the floor on the user's net
    receipt, not the gross amount returned by Zap; the router enforces this
    bound after the bot fee is taken.
  - Pass the user's stored `referrer` (same lifetime-attributed value used in /buy)
    as the `referrer` arg. Sells from a referred user also accrue to that referrer.
  - Estimate gas; submit with 1.3× buffer; show receipt.
```

Buffer-limited sells: if `redeem(sellAmount) > baseAssetBalance()`, surface: "Buffer low — max sell now is ~$X. Sell in chunks; buffer replenishes in ~10s." Never silently cap — require user to confirm the reduced amount.

**Minimum sell: `MIN_USDC_SELL_AMOUNT` from `@launchpad/shared` (currently $12 USDC of estimated proceeds)** — checked against `quotedUsdcOut` from the simulation (post-bot-fee, the user-facing number), not against the input token amount or the gross Zap output. Surface error: `` md`Minimum sell is $${MIN_USDC_SELL_AMOUNT} USDC` ``.

### /positions

```
Input:  optional wallet address (default: active wallet)
Output:
  - Open positions section:
      For each currently-held token:
        token name · ticker
        balance
        cost basis (USDC)
        current value (USDC)
        unrealised PnL (USDC, signed) · unrealised PnL %
      Per-position buttons: [Sell 50%] [Sell 100%] [View Chart]

  - Realised positions section:
      For each token with at least one closed-out chunk in lifetime:
        token name · ticker
        total cost (USDC, lifetime buy notional for closed chunks)
        total proceeds (USDC, lifetime sell notional)
        realised PnL (USDC, signed) · realised PnL %
      No action buttons (position is closed).

  - All-time only. No 24h / 7d / 30d filters.
  - No total volume, fees paid, win rate, or best/worst trade.
```

Data source: `GET /api/v1/bot/positions/:wallet` (see *Bot Fee Model → New `apps/api` endpoints*). The endpoint reads `walletBotPosition` directly — one DB row per (wallet, token) — so the bot makes a single API call regardless of how many tokens the user holds. No per-token RPC fan-out.

PnL math:

- **Cost basis** on a buy = `usdcAmount` debited from the user (from `BotRouterTrade.usdcAmount` for `side='buy'`). This is the gross USDC the user spent, so it already includes the bot fee, the Alt Fun fee, and slippage. No separate fee subtraction needed.
- **Proceeds** on a sell = USDC actually credited to the user, which is `quotedUsdcOut` minus the router's bot fee skim. The indexer reads this directly off the router event, not from the inner `Zap.sell` return value.
- **Realised PnL** uses average-cost accounting on partial sells: when the user sells `n` of `N` held tokens, the realised cost for that chunk is `costBasisUsdc × (n / N)`, the realised proceeds are the sell's net USDC, and `realisedPnlUsdc += proceeds - realisedCost`. `costBasisUsdc` is then reduced by `costBasisUsdc × (n / N)` and `tokenBalance` by `n`. Once `tokenBalance` hits zero, the token continues to appear in the *Realised positions* section (with `totalCostUsdc` and `totalProceedsUsdc` accumulating across re-entries).
- **Unrealised PnL** = `currentValueUsdc - costBasisUsdc`. `currentValueUsdc` is computed indexer-side from the latest known price for the token (curve quote pre-grad, HyperSwap pool quote post-grad), so the bot does not need a `/tokens/:addr` round-trip per holding.
- **Percentages** = `pnl / cost × 100`. Floor at 2 decimal places. When cost is 0 (e.g. fully airdropped position), display `—` instead of `∞%`.

Pagination: positions are sorted by `|unrealisedPnlUsdc|` descending for *Open*, by `realised PnL` descending for *Realised*. The 4096-char Telegram message limit applies — paginate with [Next →] when either section overflows. Open and Realised are sent as separate messages so each can paginate independently.

Stale-data guarantee: indexed numbers may lag the chain by up to one block. The bot does not surface "live" prices for positions held in volatile tokens — if the user wants the freshest mark, they pull `/track` for that token. /positions is intentionally a snapshot.

### /track

```
Input:  contract address (token only — wallet tracking is deferred)
Output:
  - Token card: name, mcap, curve fill, leverage tag, 24h price change
  - Recent trades on this token (last 20 from GET /api/v1/trades/:address)
  - Static chart image (24h candles from `GET /api/v1/chart/:address?timeframe=1d`)
  - Buttons: [Buy →] [Sell →] [Open on Alt Fun]
```

v1 is info-only — no alert subscriptions. Persistent price / graduation alerts are **deferred** (require `apps/api` alert endpoint and a keeper, neither of which exist).

### /withdraw

Multi-step confirmation flow:

1. Show withdrawal summary: asset, amount, destination, estimated network fee
2. Whitelist check: if withdrawal whitelist enabled in `/security`, reject non-whitelisted addresses with "Address not in whitelist. Manage in /security."
3. PIN prompt
4. [Confirm Withdraw] button with 60s timeout — expired confirms are silently dropped

```
Effects: sign and submit native HYPE transfer or ERC-20 transfer via rpc.ts
```

Network fee: estimate via `eth_estimateGas` before prompting. Show fee in USDC equivalent.

### /settings

| Setting | Default | Description |
|---|---|---|
| Slippage | 1% (100 bps) | Applied to buy/sell. Stored as `session.slippageBps` and read by `lib/execute.ts` on every confirm. Presets `0.5% / 1% / 2% / 5%` surface as one-tap buttons; the [Custom %] button opens a wizard capped at 50% (any higher would trip `lib/trade.ts`'s `slippageBps ≤ 10_000` guard). |
| Default buy amount | $50 USDC | Stored as `session.defaultBuyUsdc`. The [Default buy: $N] button opens a wizard floored at `MIN_USDC_BUY_AMOUNT` from `@launchpad/shared` and capped at $10,000. Wizard rounds to whole USDC — sub-dollar precision is button-label noise. |
| Degen mode | Off | One-tap toggle. Stored as `session.degenMode`. Persisted now; consumed once `/buy` and `/sell` learn to skip confirm steps when it's on. PIN gates stay active regardless of degen mode — toggling this never bypasses authentication. |

State lives entirely on the grammY session (KV-backed under `session:<userId>`) — same store every other setting on this bot uses. No new KV namespace, no new endpoints.

**Anti-phishing phrase is managed exclusively in `/security`** — surfaced on the `/settings` panel only as a one-line pointer (`"Anti-phishing phrase lives in /security."`). Owning the phrase from two commands would double the audit surface for the impersonation defence; AGENTS.md `/security → Anti-phishing prepend` is the single source of truth.

**Deferred in v1** (deliberately not surfaced to avoid storing UI state that no code consumes):

- **Priority fee** — `lib/trade.ts` submits with `estimateContractGas` + 1.3× buffer using the wallet's default gas pricing. There is no priority-fee field on the session and no plumbing from session → trade builder. Reintroduce alongside the wallet-fee-routing change in `lib/trade.ts`.
- **MEV protection** — HyperEVM has no public Flashbots-style protected RPC endpoint today; routing a "protect" toggle through the same `HYPEREVM_RPC_URL` is purely cosmetic. Reintroduce when an alternate RPC binding lands.
- **Trade confirmations toggle** — `/buy` and `/sell` always show the Confirm button (60 s timeout, nonce-gated). Until those flows learn to branch on the degen-mode flag and skip the staging step, exposing a separate "Trade confirmations: on/off" toggle would be a dangling UI control.

Notifications (trade fills, TP/SL triggers, graduation alerts) are intentionally absent from v1 — they require either a keeper or alert-subscription endpoint, both deferred. The bot replies inline to every command but does not push unsolicited messages.

Degen mode: documented as "skip confirmations and risk warnings" once `/buy` and `/sell` consume it. Today only persists the flag — flipping it has no behavioural effect on trades. The toggle is exposed so the surface area is testable + recoverable from now; the trade-side wiring lands in a follow-up.

### /security

```
Output:
  - PIN status (set / not set)
  - Active Telegram sessions
  - Withdrawal lock status
  - Anti-phishing phrase (set / not set)

Actions via inline keyboard:
  - Set PIN / Change PIN (6-digit numeric; bcrypt-hashed in KV).
    Change-PIN verifies the existing PIN first (subject to the 5-attempt
    lockout) before prompting for the new one.
  - Reset PIN (24h delay) — see "PIN reset flow" below
  - Set / Change / Clear anti-phishing phrase (≤ 64 chars; stored on the
    grammY session). The phrase replaces the static anti-phishing
    header on every outbound chat message — see *Anti-phishing prepend*
    below.
  - Enable / Disable withdrawal lock. Enable is instant; disable is a
    two-phase request → 24h cooldown → second tap that actually clears
    the lock. A pending disable surfaces a [Cancel disable] button so
    the user can revoke it.
  - Revoke all sessions — DEFERRED (no session-token system shipped;
    grammY's KV-backed session is implicit per Telegram user, not a
    bearer token the user can revoke).
  - Manage withdrawal address whitelist — DEFERRED until `/withdraw` ships.
```

**Anti-phishing prepend.** The user phrase (`ctx.session.antiPhishingPhrase`, set via /security) is prepended to every outbound chat message via `lib/anti-phishing.ts :: wrapWithCtxPhrase` (aliased to `wrap` in each command file) — `withAntiPhishing(body, phrase)` resolves the per-user phrase or, when none is set, falls back to the static `ANTI_PHISHING_HEADER`. Two ctx flavors deliberately fall back to the static header even when the user has a phrase set: grammY conversations replay (no `session` property on the replay-time ctx) and channel-post / anonymous-admin updates (session-key resolver returns undefined). In both cases the static fallback is correct — replays render system-style prompts where impersonation isn't the threat, and there is no per-user session to consult for the non-user contexts. Toast / `answerCallbackQuery` text is exempt (200-char budget, not an impersonation surface).

PIN brute-force protection: 5 wrong attempts → 30-minute lockout. Lockout state stored in KV with TTL.

**PIN reset flow (forgotten PIN).** Without a reset path, a forgotten PIN permanently locks a user out of their funds. Reset is available via [Reset PIN] in `/security` and works as follows:

1. User requests reset → bot records a `pin_reset_requested_at` timestamp in KV and surfaces a toast: "PIN reset requested. Complete in ~24h. The old PIN still works during the cooldown."
2. During the 24-hour window, the existing PIN remains valid. The legitimate user keeps full bot access; the delay window is for *spotting* a hostile reset request from a compromised Telegram session and revoking it via [Cancel PIN reset]. Locking out the user entirely (the earlier draft of this spec) gave no extra security — an attacker with stolen Telegram session does not gain access during the cooldown either way — and stranded legitimate users from their funds for a day.
3. After 24 hours, the [Complete PIN reset] button in `/security` opens a new-PIN wizard; on confirmation the new bcrypt hash replaces the old one and the reset state clears. The cooldown is re-checked at write time, so a stray callback in the last seconds before `readyAt` cannot bypass the gate.
4. [Cancel PIN reset] in `/security` wipes the request without touching the hash. Surfaced as the only action on the status row while a reset is pending, so the path to revoke is one tap from the panel.

The 24-hour delay mirrors the withdrawal lock cooldown. Do not allow instant reset — a stolen Telegram session + instant reset = full funds drain.

**Notification on reset request:** v1 does not push a separate Telegram notification at the start of the cooldown; the toast surfaces on the resetting client, and the next `/security` open shows the panel state. A dedicated push notification (so a victim on a different client sees the reset request even if they never open `/security`) lands when the bot adds outbound notification infrastructure for price / graduation alerts (see *Deferred features*).

### /referral

```
Output:
  - Your referral link: t.me/<botname>?start=ref_<username>
    (falls back to t.me/<botname>?start=ref_<userId> if the sharer has
    no Telegram username — usernames are optional in Telegram)
  - Your rewards wallet: 0xABCD...1234   [Change rewards wallet]
  - Referred users: N
  - Lifetime earned: $X USDC

  Buttons:
  - [Change rewards wallet]
  - [Copy link]
```

There is **no** claim, withdraw, or payout button. Referrer cuts settle on-chain to the rewards wallet in the same transaction as the referred user's trade. See *Bot Fee Model* for the split mechanics. The user's rewards wallet shown here is wherever those USDC payments are already arriving.

#### Rewards wallet

- Defaults to the user's active custodial bot wallet on first /start. The bot writes this default into KV at /start so the wallet is unambiguous from day one.
- Settable via [Change rewards wallet] → wizard prompts for an address (any HyperEVM address — does not have to be a bot custodial wallet). PIN-gated.
- Stored as the user's `rewardsWallet` in KV via `POST /api/v1/bot/referrals/:wallet/rewards-wallet`.
- **Effect on past attributions:** changing the rewards wallet does NOT redirect already-attributed referees. On-chain attribution is by the referrer arg the bot passed in those referees' first buys. Once a referee has a non-zero `referrer` recorded on chain in their first router trade, every subsequent trade of theirs continues to pay that exact address forever — even if the referrer later changes their bot rewards wallet. To redirect future earnings from existing referees, the user must control the previously-set address. **Surface this clearly in the wizard before confirmation.**
- **Implication:** the rewards wallet should be set correctly on day one, ideally to a long-lived address the user controls (a hardware wallet or main custodial wallet). The bot warns if the user attempts to set the rewards wallet to an exchange deposit address pattern (rotating addresses) or a known burn address.

#### Referrer attribution (lifetime, immutable after first trade)

- Recorded on first /start when the deeplink param is `ref_<referrerUsername>` (preferred) or `ref_<referrerUserId>` (fallback when the sharer has no Telegram username). The bot resolves the handle → that referrer's `rewardsWallet` via the indexer / api at /start time, and stores that resolved wallet address as the new user's `referrer` in KV.
- The stored `referrer` is what the bot passes to `BotFeeRouter.buyWithBotFee` / `sellWithBotFee` on every subsequent trade by this user. This makes it lifetime by construction: every trade pays out, forever, to the address resolved at /start.
- Subsequent /start calls do not overwrite an existing `referrer`. Same `ChatDO` serialisation as profile creation (see /start).
- If the referrer's rewards wallet is unset at the moment the new user runs /start (the referrer hasn't onboarded their own bot account yet), the deeplink is dropped silently and the new user has `referrer = address(0)` permanently. **No retro-linking.** Surface in the deeplink referrer's /referral the next time they open it: "Some users hit your link before you finished setup; their attribution was not assigned. Check that your rewards wallet is set so this doesn't happen again."
- Self-referral allowed (router has no guard). Bot does not warn or block — users self-referring just lower their effective bot fee from 0.5% to 0.4%.

#### Stats source

`GET /api/v1/bot/referrals/:wallet` returns `{ referredCount, lifetimeEarnedUsdc, rewardsWallet }`. The two numbers come from `referrerStats` in the shared indexer:

- `referredCount` = distinct trader wallets where `BotRouterTrade.referrer == this user's rewardsWallet` and `BotRouterTrade.referrerCut > 0` (the bad-referrer-wallet fallback excludes failed-payout trades from the earned total — see below).
- `lifetimeEarnedUsdc` = `Σ ReferralPaid.amount` for `referrer == this user's rewardsWallet`. Counts only successful on-chain transfers, so it matches the user's actual USDC receipts to the wei.

#### Bad-referrer-wallet detection

If the indexer observes `BotRouterTrade.referrerCut == 0` while `referrer == this user's rewardsWallet` (i.e. the on-chain transfer to the user's rewards wallet failed and the cut went to treasury), it tags the referrer as "rewards wallet rejecting payments" and the bot surfaces a banner at the top of /referral:

> Your rewards wallet is rejecting USDC transfers — N referral payments rolled into treasury and are not recoverable. Update your rewards wallet to fix future payments.

Do not retroactively re-pay the lost cuts. They are gone (correct: the on-chain split is final, the treasury cut is sweeping into the cold wallet). The banner is preventative for future trades only.

---

## Security Model

| Threat | Mitigation |
|---|---|
| Key theft via KV breach | AES-256-GCM per-user encryption; master key in Worker secret, never in KV |
| PIN bypass | bcrypt hash; 5-attempt brute-force lockout (30 min) |
| Forgotten PIN locking funds | 24-hour delayed PIN reset flow; user notified at request and when window opens |
| Compromised Telegram + PIN reset | 24-hour delay gives user time to cancel reset before it takes effect |
| Phishing bot | Anti-phishing phrase in every message header |
| Withdrawal to wrong address | Whitelist mode; confirm timeout 60s; withdrawal lock with 24h cooldown to disable |
| Private key leak in chat | Import wizard deletes user message immediately; export is ephemeral (30s auto-delete) |
| Replay of confirm buttons | Each confirm callback includes a one-time nonce stored in session; replays are no-ops |

**Never log private keys or PIN values.** Worker logs are accessible to anyone with Cloudflare dashboard access.

---

## Infrastructure

| Component | Provider | Details |
|---|---|---|
| Bot runtime | Cloudflare Workers | Webhook mode; same account as `apps/api` |
| Session + wallet storage | Cloudflare KV | Namespace: `launchpad-telegram` |
| Update serialisation | Cloudflare Durable Objects | `ChatDO` — one DO per chat (`idFromName("chat:${chatId}")`); serialises every grammY update for the chat on its single-threaded event loop. Closes the WAR hazard for `session` + `conversations` KV writes and, because `/start` and `/wallet` are private-DM only (where `chat.id == from.id`), also serialises onboarding writes (profile, referrer, rewards-wallet default) per user. |
| Chart renderer | Worker (WASM) | `lib/chart.ts` — SVG built from the `/api/v1/chart/:address` candle snapshot, converted to PNG via `@resvg/resvg-wasm`; no external service |
| Alt Fun API | `apps/api` (Cloudflare Workers) | Internal service binding (zero egress latency) |
| Blockchain RPC | Alchemy (HyperEVM) | Same `HYPEREVM_RPC_URL` secret as `apps/api` |
| Telegram webhook | Telegram Bot API | Registered via `POST /setWebhook` on deploy |

No keeper or broadcast Durable Objects in v1. Snipe / copy / alert features that would require them are deferred until `apps/api` exposes the matching order / alert endpoints — see *Deferred features*. `ChatDO` is the only DO the bot owns.

---

## Telegram Platform Constraints

These are non-obvious Telegram API limits that will cause silent failures if ignored.

- **4096 char message limit.** Position lists and portfolio summaries must paginate. Use inline [Next →] buttons — never send one giant message. `format.ts` must truncate/chunk before calling `sendMessage`.
- **`callback_data` 64-byte limit.** Inline button payloads must be compact. Use short codes (`s:50:<addr8>` = sell 50% of token with 8-char address prefix) rather than full contract addresses. Decode and resolve in the callback handler.
- **MarkdownV2 escaping.** Telegram's MarkdownV2 requires escaping `.` `-` `(` `)` `!` `+` `=` `#` `>` `{` `}` and more. An unescaped special char silently drops the entire message with a 400. All user-facing strings must pass through the whitelist escaper in `format.ts` — never build MarkdownV2 strings ad-hoc.
- **`editMessageText` 400 on deleted messages.** If the user deletes a bot message and the bot tries to edit it, Telegram returns 400 `message not found`. Always catch this and treat as a no-op — never let it surface as an unhandled error.
- **`deleteMessage` 48-hour window.** Bot can only delete messages younger than 48 hours. The export-private-key 30s auto-delete is safe. Do not schedule deletes for anything older — they will silently fail.
- **One webhook per token.** Only one URL can receive updates for a given bot token. Staging and prod must use separate bot tokens (separate BotFather bots), not the same token pointed at different URLs.
- **Webhook secret header.** Set `secret_token` on `setWebhook` and validate `X-Telegram-Bot-Api-Secret-Token` on every incoming request. Requests without the header are unauthenticated and must be rejected 403 before any handler runs.
- **Global 30 msg/sec Telegram limit (awareness only in v1).** Telegram rejects outbound messages with 429 if the bot exceeds 30 messages per second across all recipients. v1 only sends inline replies (one `ctx.reply()` per webhook), so this limit is not reachable. When notification features land (deferred), a `BroadcastDO`-style queue must front every bulk send — do not regress to direct `ctx.reply` loops for fan-outs.
- **Service binding scope (Cloudflare).** The bot binds to `apps/api` as an internal service binding — zero egress, no edge cache. **The binding does not bypass auth:** every bound call still hits `apiKeyAuth` and must send the bot's dedicated `X-API-Key` (see *Auth model* under *API surface consumed from apps/api*). Bound calls also bypass the Cloudflare edge cache, so the 15–30 s `s-maxage` on aggregate routes does nothing for the bot — assume every binding call is uncached and rely on the indexer-side O(1) counters instead.

---

## Local Dev

Telegram cannot deliver webhooks to `localhost`. Use grammY's long-polling mode for local development via a dedicated `src/dev.ts` entrypoint — same handlers, different transport. Never use long-polling in production (no horizontal scale, misses updates during restarts).

```sh
# Install deps
cd apps/telegram-bot && npm install

# Copy secrets template
cp .dev.vars.example .dev.vars
# Fill in BOT_TOKEN (use a dedicated dev bot from BotFather, NOT the prod token)
# Fill in MASTER_KEY (generate: openssl rand -base64 32)
# Point API_BASE_URL at http://localhost:8787 (run apps/api concurrently)

# Run in polling mode
# Once scaffolded, npm run dev will wrap this. Until then run directly:
npx tsx src/dev.ts
```

Service binding to `apps/api` does not work under `wrangler dev --local`. Set `API_BASE_URL=http://localhost:8787` in `.dev.vars` and run `apps/api` with `wrangler dev` concurrently.

KV under `wrangler dev --local` is in-memory and does not persist between restarts. Wallets created locally are ephemeral — expected behaviour, not a bug.

Use a dedicated BotFather test bot for local dev. Never point dev at the production `BOT_TOKEN` — Telegram delivers each update to exactly one webhook/poller, so dev and prod would race for messages.

---

## Hosting

Cloudflare Workers (same account as `apps/api`). Deployed via `wrangler deploy`. The `Deploy Telegram Bot` GitHub Action runs `wrangler deploy` and then `scripts/register-webhook.sh`, which POSTs to the Worker's own `/admin/set-webhook`. That route is the single place that owns the `allowed_updates` list — currently `["message", "callback_query"]` — so every deploy refreshes the registration. This matters because Telegram's `setWebhook` is sticky: a stale registration silently drops any update type not in its list (we hit this when `callback_query` landed but the existing registration was still `["message"]`, so every inline-button press dropped on the floor with no log). To re-register manually:

```sh
WORKER_URL=https://launchpad-telegram-bot.<subdomain>.workers.dev \
ADMIN_API_KEY=... \
npm run deploy:webhook --workspace apps/telegram-bot
```

No persistent process — stateless webhook handler. `ChatDO` is the only Durable Object and is instantiated lazily on the first update for each chat; no deploy-time kick required.

### Secrets (set via `wrangler secret put`)

| Secret | Purpose |
|---|---|
| `BOT_TOKEN` | Telegram Bot API token from BotFather |
| `MASTER_KEY` | AES-256-GCM master encryption key for custodial wallets — 32 bytes, base64-encoded. **Rotating this invalidates all stored wallets.** No re-encryption migration exists in v1. Treat as a root CA key. |
| `WEBHOOK_SECRET` | Validated on every incoming Telegram request (`X-Telegram-Bot-Api-Secret-Token`) |
| `HYPEREVM_RPC_URL` | Alchemy HyperEVM endpoint (same value as `apps/api`) |
| `API_KEY` | Dedicated `X-API-Key` for the bot's calls to `apps/api`. Provisioned via the `apiKeys` table with a fleet-aggregate rate limit (the bot fans many users through one Worker IP, so the anonymous 240/min ceiling would starve under any real load). Rotate by issuing a new row, redeploying with the new secret, then deactivating the old row. |
| `BOT_FEE_ROUTER_ADDRESS` | Deployed `BotFeeRouter` contract address. The bot routes every `/buy` and `/sell` through this contract. Rotation = deploy a new router and push the new address; immutable parameters (`botFeeBps`, `referrerShareBps`, `treasury`) require a new deployment. |

### Env vars (in `wrangler.jsonc`)

| Var | Value |
|---|---|
| `ENVIRONMENT` | `production` \| `staging` \| `development` |
| `KV_NAMESPACE_ID` | Binding ID for the `launchpad-telegram` KV namespace |

---

## Error Handling

Explicit degraded-state behaviour for each dependency. Never show stale data as live; never silently swallow failures.

| Dependency | Failure mode | Bot behaviour |
|---|---|---|
| `apps/api` unreachable | 503 / timeout | Reply: "Data temporarily unavailable — try again in a moment." Abort the command. |
| Ponder degraded | `apps/api` returns null curve fields | Show token card with `curveFilled` only; omit organic/leverage split. Mirror the `apps/api` degraded fallback — see [apps/api/AGENTS.md](../api/AGENTS.md#token-enrichment-graduation-progress-bar). |
| HyperEVM RPC down | `eth_sendRawTransaction` fails | Reply with error + raw message. Do not retry automatically — user must re-initiate. |
| Tx reverted | Receipt `status = 0` | Decode revert reason if possible (e.g. "TradingNotOpen", "InsufficientBalance"). If not decodable, show tx hash + "Transaction failed — check explorer." |
| BounceTech buffer low | `baseAssetBalance()` < sell value | Surface before tx construction, not after revert. Show max available. Require user to confirm reduced amount. |
| KV write failure | Wallet or session not persisted | Reply: "Failed to save — please retry." Never proceed assuming the write succeeded. |
| `deleteMessage` on old message | 400 from Telegram API | Catch and treat as no-op. Log for debugging but do not surface to user. |
| `editMessageText` on deleted message | 400 `message not found` | Catch and treat as no-op. |

---

## Key Constraints

- **No Privy wallets — bridge the gap explicitly.** The web app uses Privy; the bot uses its own custodial layer. Users have separate addresses unless they import the same key. The `/wallet` import action must display a prominent "Import from Web App" label with instructions to export the Privy key and paste it here. Never treat this as an implementation detail — it is the #1 source of user confusion.
- **All MarkdownV2 strings must use the `md` template tag.** Never build MarkdownV2 strings with raw template literals — any `.` `-` `(` `)` in a price or token name causes a silent 400. Use the `md` tag from `lib/format.ts` which escapes interpolated values automatically: `` md`Price: ${price} USDC` ``. This is a lint-enforced rule: `no-restricted-syntax` bans bare template literals in any file that imports from `lib/format.ts`.
- **Minimum trade: read `MIN_USDC_BUY_AMOUNT` / `MIN_USDC_SELL_AMOUNT` from `@launchpad/shared`.** Currently $20 buy / $12 sell, both above BounceTech's $10 LT floor. Enforce client-side before constructing any tx. Do not hardcode the number — the buffer is tuned per-release and is shared with `apps/web` (`TradePanel.tsx`, `format.ts`) plus the web `useCreateToken` anti-snipe floor.
- **Buffer-limited sells must be user-visible.** Never silently cap — show max available and require confirmation of the reduced amount.
- **Always derive slippage bounds from a simulation.** Mirror `useTradeRouter.executeBuy` / `executeSell` exactly: simulate the trade with `min*Out = 0` to get a quote, then submit the real tx with `min*Out = quote * (10_000 - slippageBps) / 10_000`. Floor `minUsdcOut` at 1 wei when the quote is non-zero. **Never submit a Zap trade with `minTokensOut = 0` or `minUsdcOut = 0` from a live signer — that is a fully-sandwichable trade.** Same constraint applies whether the path is `buy` / `sell` or `buyWithPermit` / `sellWithPermit`.
- **Permit-first, approve as fallback.** Default to `BotFeeRouter.buyWithBotFeePermit` / `sellWithBotFeePermit` for any token whose `permit` signature succeeds — the bot holds the private key, so signing EIP-2612 has zero UX cost and saves a tx. Fall back to legacy `approve(BotFeeRouter, maxUint256)` + plain `buyWithBotFee` / `sellWithBotFee` only when permit signing throws (pre-permit token vintage). Match the try/catch ladder in `apps/web/src/hooks/useTradeRouter.ts`, but the approval target and call target are **the router, not Zap**.
- **Fees: Alt Fun 0.5% + bot 0.5% on every buy/sell.** Alt Fun's protocol fee is unchanged (0.5%, curve and post-grad alike, plus HyperSwap LP 0.3% post-grad). The bot adds a flat 0.5% on top, charged in USDC at the router. See *Bot Fee Model*.
- **Degen mode does not bypass PIN.** Only skips UI confirmation steps and risk-warning copy.

---

## Programming Style

### Modularisation

One logical unit per file. Split aggressively — if a class or function group serves a single responsibility and could be imported independently, it lives in its own file.

```
src/
  bot.ts                  — Bot instance only; imports everything, registers nothing inline
  commands/
    start.ts              — /start handler
    buy.ts                — /buy handler
    sell.ts               — /sell handler
    wallet.ts             — /wallet handler
    positions.ts          — /positions handler
    track.ts              — /track handler
    withdraw.ts           — /withdraw entry point (delegates to scene)
    settings.ts           — /settings handler
    security.ts           — /security handler
    referral.ts           — /referral handler
    help.ts               — /help handler
  scenes/
    withdraw-wizard.ts    — Multi-step withdraw confirmation scene
    wallet-import.ts      — Multi-step wallet import scene
  keyboards/
    main-menu.ts          — Main menu inline keyboard
    buy-amounts.ts        — Quick-buy amount buttons
    sell-percentages.ts   — 25/50/75/100% sell buttons
    wallet-actions.ts     — Wallet action buttons
    position-actions.ts   — Sell-50%/Sell-100%/View-Chart per-position buttons
  lib/
    wallet.ts             — WalletManager class (encrypt/decrypt/store/load)
    trade.ts              — TradeBuilder class (calldata construction)
    session.ts            — SessionStore class (KV-backed per-user state)
    pin.ts                — PinManager class (hash/verify/lockout/reset-flow)
    format.ts             — Formatters, MarkdownV2 escaper, and `md` template tag (see Key Constraints)
    chart.ts              — ChartRenderer: fetches candle snapshot from `GET /api/v1/chart/:address` via api.ts (pass `timeframe=1d` for the 24h /track image), builds SVG, converts to PNG via @resvg/resvg-wasm
    logger.ts             — Structured logger (no console.log outside this module)
  chat-do.ts              — ChatDO: per-chat update serialisation (single DO event loop in front of grammY's session/conversations KV writes; for private-DM-only commands like /start and /wallet this also serialises per-user, since chatId == userId in DMs)
  api.ts                  — ApiClient class (typed wrapper around apps/api)
  rpc.ts                  — RpcClient class (HyperEVM RPC, tx submission)
  middleware/
    auth.ts               — PIN gate middleware
    anti-phishing.ts      — Prepends anti-phishing phrase to all replies
    rate-limit.ts         — Per-user command rate limiting
```

Do not put handler logic in `bot.ts`. `bot.ts` only instantiates the bot, wires middleware, and calls `.command()` / `.on()` with imported handlers.

### Linting

ESLint with TypeScript strict mode. Config extends the shared `@launchpad/config/eslint` preset (same as `apps/api`). All rules must pass before merge — CI blocks on lint errors.

Key enforced rules:
- `@typescript-eslint/no-explicit-any` — error. Use typed interfaces; never cast to `any`.
- `@typescript-eslint/no-floating-promises` — error. Every async call must be awaited or explicitly `.catch()`-ed.
- `no-console` — error in non-lib files. Use a structured logger in `lib/logger.ts`.
- `@typescript-eslint/explicit-function-return-type` — error on exported functions.

```sh
npm run lint          # eslint check
npm run lint --fix    # auto-fix where possible
npm run typecheck     # tsc --noEmit
```

Both must pass clean before opening a PR.

---

## Testing

Red-green for every requirement: write a failing test that captures the requirement, then implement until it passes. Do not merge implementation without a corresponding test.

Test runner: **Vitest** (same as `apps/api`). No integration with Telegram's actual API in unit tests — mock `ctx` and `bot` using grammY's test helpers.

```
src/
  __tests__/
    commands/
      buy.test.ts
      sell.test.ts
      wallet.test.ts
      withdraw.test.ts
      security.test.ts
      settings.test.ts
      start.test.ts
      positions.test.ts
      track.test.ts
      referral.test.ts
    lib/
      wallet.test.ts
      pin.test.ts
      format.test.ts
      trade.test.ts
    api.test.ts
    rpc.test.ts
```

### Required test cases per area

**`lib/wallet.test.ts`**
- Encrypt + decrypt round-trip returns original private key
- Two users with same key produce different ciphertexts (per-user IV)
- Decrypting another user's ciphertext throws (per-user key isolation)
- Decrypting with wrong `MASTER_KEY` throws
- KV write failure on `save` propagates as thrown error (not silent)
- `generateWalletId` returns the `w_` + 6 base32 char shape, is collision-free across 1000 samples, and fits inside the 64-byte `callback_data` budget under worst-case action prefixes
- `createWallet` makes the first wallet active, does not overwrite active on subsequent creates, and enforces `MAX_WALLETS_PER_USER` via `TooManyWalletsError`
- Created wallets round-trip encrypt → store → decrypt (regression for userId mismatch between encrypt and decrypt)
- `setActive` switches between wallets, throws `WalletNotFoundError` on an unknown id, and is a no-op when the target is already active (no spurious KV write)
- `renameWallet` mutates only the `label`; address + encryptedKey untouched
- `deleteWallet` removes the record, reassigns active to the next wallet when the active one is deleted, sets active to `null` when the last wallet is deleted, and throws `WalletNotFoundError` on an unknown id
- `listWallets` returns wallets in creation order, returns `[]` for an empty user, and drops orphan index entries (`index` references a record that was never persisted) instead of crashing the picker

**`lib/pin.test.ts`**
- Correct PIN verifies successfully
- Wrong PIN increments attempt counter
- 5 wrong attempts sets lockout TTL in KV
- Attempt during lockout rejects immediately without checking hash
- Successful PIN clears attempt counter

**`lib/format.test.ts`**
- MarkdownV2 escaper escapes all reserved chars: `. - ( ) ! + = # > { }`
- Token card truncates name/ticker to fit within 4096-char message budget
- Signed-number formatter renders positive amounts with `+` prefix and negative with `−` (e.g. unrealised PnL, realised PnL deltas in /positions)
- Long position lists split into chunks ≤ 4096 chars each, with /positions Open and Realised sections paginated independently

**`commands/buy.test.ts`**
- Amount below `MIN_USDC_BUY_AMOUNT` (read from `@launchpad/shared`) → error reply, no simulation, no tx constructed
- Valid contract address → token card rendered with name, mcap, curve fill, and fee summary line ("Bot fee 0.5% + Alt Fun fee 0.5%")
- Token card shows referrer line ("(0.1% goes to your referrer)") iff user has a registered referrer in KV
- LT mint-paused (router surfaces inner Zap revert) → "Buys paused for this token" reply, no raw revert exposed, no tx constructed
- Confirm button with expired nonce → no-op (no tx submitted)
- Confirm button with valid nonce → simulation of `BotFeeRouter.buyWithBotFee` (NOT `Zap.buy`) runs, `minTokensOut` derived from the post-bot-fee `quotedTokensOut`, real tx submitted with that bound (never `minTokensOut = 0`)
- Approval target is `BotFeeRouter`, not `Zap` — assert spent `approve` calls and permit `spender` arg both target the router address
- `referrer` arg passed to the router equals the user's stored `referrer` in KV (or `address(0)` if none)
- Permit branch: token supports EIP-2612 → `buyWithBotFeePermit` path taken, no separate approve tx
- Approve branch: permit signing throws → `approve(BotFeeRouter, maxUint256)` submitted, then plain `buyWithBotFee`
- Degen mode bypasses confirm step and goes straight to simulation+tx (still derives slippage bound, still routes through router)
- `apps/api` 503 → "Data temporarily unavailable" reply, no crash

**`commands/sell.test.ts`**
- Sell 50% of position → correct token amount computed as `tokenAmount × 0.5`, where `tokenAmount` is the live indexed balance from `GET /api/v1/bot/positions/:wallet` (sourced from `walletBotPosition.tokenBalance`). Never compute the sell size from `costBasisUsdc` — that field is cost basis in USDC and has no meaningful unit relationship to the token amount being sold.
- Sell 100% → full position submitted
- Simulation runs against `BotFeeRouter.sellWithBotFee` (NOT `Zap.sell`); `minUsdcOut` is derived from the post-bot-fee `quotedUsdcOut` so it represents the user's net receipt
- Slippage bound: quote × (10_000 − slippageBps) / 10_000; floor at 1 wei when quote > 0 and result would round to 0
- Estimated proceeds below `MIN_USDC_SELL_AMOUNT` → error reply, no tx constructed (the check runs against post-bot-fee quoted USDC out, not the input token amount or the gross Zap output)
- Buffer < sell value → surface max available, require reduced-amount confirm
- Approval target is `BotFeeRouter`, not `Zap`
- `referrer` arg passed to the router equals the user's stored `referrer`
- Permit branch: token supports permit → `sellWithBotFeePermit` path taken
- Approve fallback when permit signing throws
- Ticker resolves to contract address via `api.ts`
- Unknown ticker → "Token not found" reply

**`commands/withdraw.test.ts`**
- Address not in whitelist (when whitelist enabled) → rejected before PIN prompt
- Wrong PIN → counter incremented, lockout after 5
- Confirm timeout (>60s) → confirm callback is no-op
- Valid flow → `eth_sendRawTransaction` called, tx hash returned in reply

**`commands/security.test.ts`**
- Set PIN stores bcrypt hash, not plaintext
- Disable withdrawal lock within 24h cooldown → rejected with cooldown message
- Revoke sessions → all session tokens invalidated in KV

**`commands/start.test.ts`**
- First `/start` → user profile created in KV
- Referral deeplink `ref_<refUserId>` where the referrer has a registered `rewardsWallet` → bot resolves to that wallet via api and stores it as the new user's `referrer` in KV (NOT the userId)
- Referral deeplink where the referrer has not yet onboarded (no `rewardsWallet`) → deeplink dropped silently, new user has `referrer = address(0)`, no retro-link when the referrer later onboards
- Second `/start` → does not overwrite `referrer` or existing profile (lifetime, immutable after first set)
- Self-referral (`ref_<own userId>`) → allowed; the resolved address is the new user's own rewards wallet (which equals their custodial wallet on day one)

**`commands/positions.test.ts`**
- Single GET to `/api/v1/bot/positions/:wallet` returns both Open and Realised sections — assert no per-token RPC fan-out
- Open positions render token, balance, cost basis, current value, unrealised PnL ($ + %)
- Realised positions render token, total cost, total proceeds, realised PnL ($ + %)
- Cost basis from a buy includes the bot fee (i.e. for a $20 buy, cost basis on the resulting position is $20, not $19.90) — assert against a fixture `BotRouterTrade` event
- Sell of 50% of an open position → realised PnL row reflects exactly half the cost and half the indexer-side cost basis is decremented (next /positions read shows the remaining 50% as Open)
- Position with `costBasisUsdc = 0` (e.g. fully airdropped) renders `—` for unrealised PnL %, not `∞%` or `NaN%`
- Open and Realised sections paginate independently — each fits in ≤ 4096 chars, [Next →] buttons surface when overflowing
- Empty wallet → "No positions yet — try /buy <contract>" reply, no API call retried
- `apps/api` 503 → "Data temporarily unavailable" reply, no stale-cache fallback

**`commands/referral.test.ts`**
- Renders link, rewards wallet, referred count, lifetime earned — sourced from `/api/v1/bot/referrals/:wallet`
- Default rewards wallet on first /start is the user's active custodial wallet — assert KV write at /start, not lazy on first /referral
- [Change rewards wallet] wizard: PIN-gated, accepts any HyperEVM address, persists via `POST /api/v1/bot/referrals/:wallet/rewards-wallet`
- Wizard surfaces a clear warning that past attributions do NOT redirect on rewards-wallet change
- Bad-referrer-wallet banner: when the indexer reports `referrerCut == 0` for at least one trade where `referrer == this user's rewardsWallet`, the banner appears at the top of /referral with a count of failed payments
- Failed payments banner does NOT include a "claim refund" button — the lost cuts are unrecoverable, surface only as preventative copy
- Self-referral case: lifetime earned correctly accumulates the user's own self-referral cut on their own trades
- No claim/withdraw/payout button anywhere in the screen

**`commands/settings.test.ts`**
- Status view renders the default trio (`Slippage: 1%` / `Default buy: $50 USDC` / `Degen mode: off`) on a brand-new account, with the [• 1% •] preset marked and an `Anti-phishing phrase lives in /security` pointer
- `/settings` in a group chat is rejected with the "private-DM only" copy and never leaks slippage / buy-amount state into the group transcript
- Tapping a preset slippage button (`set:slip<bps>`) persists the new `slippageBps` on the session and the panel edit reflects the new value
- A malformed `set:slip…` callback payload (no integer) is a no-op — session unchanged, no crash
- Degen-mode toggle flips `session.degenMode` on the first tap and back off on the second; both branches surface the matching toast
- Custom-slippage wizard accepts decimal percent input (e.g. `2.5` → `250` bps), capped at 50% (`100` rejected with "capped at 50%" copy), rejects non-numeric input, and `/cancel` exits without touching the session
- Default-buy wizard rounds to whole USDC (`$75.4` → `75`), floors at `MIN_USDC_BUY_AMOUNT` (a `5` USDC entry is rejected with the minimum-buy copy and the session is unchanged)

**`api.test.ts`**
- All methods return typed responses matching `apps/api` schema
- 503 from API propagates as typed error, not unhandled rejection
- Null curve fields (Ponder degraded) handled without crash

**`rpc.test.ts`**
- Reverted tx (status 0) → decoded revert reason returned
- RPC timeout → throws with message, does not retry

### Running tests

```sh
npm run test           # vitest run (all)
npm run test:watch     # vitest watch (dev loop)
npm run test:coverage  # coverage report — target ≥ 80% line coverage on lib/
```

---

## Functional Spec

**This AGENTS.md is the living functional spec.** When a conversation introduces or changes specific behaviour — a new command flow, an edge case resolution, a security decision — that behaviour must be documented here before the PR is merged. Do not leave behavioural decisions only in PR descriptions or chat history; they rot and become invisible.

When to update this file:
- A new command or action is added → add a spec entry under *Command Specifications*
- An edge case is resolved in conversation (e.g. "what happens if the buffer runs out mid-sell?") → document the resolution in the relevant command spec
- A platform constraint is discovered (new Telegram API limit, new RPC behaviour) → add to *Telegram Platform Constraints* or *Error Handling*
- A security decision is made → add to *Security Model*
- A test requirement is agreed → add a test case entry under *Testing*

Keep entries precise enough that a developer who wasn't in the conversation can implement the behaviour correctly from the spec alone.

---

## Verification

```sh
# Local dev (long-polling mode)
# npm run dev wraps `npx tsx src/dev.ts` once the app is scaffolded
cd apps/telegram-bot && npx tsx src/dev.ts

# Smoke-test sequence in BotFather test bot
/start
/wallet         → create wallet → verify KV entry exists
/buy <contract> → token card renders → confirm → tx hash returned
/sell <ticker> 50% → position summary renders → confirm → receipt returned
/positions      → open positions list
/withdraw USDC 1 <address>  → PIN prompt → confirm button → tx submitted
/settings       → toggle degen mode on/off
/security       → set PIN → verify lockout after 5 wrong attempts
```

Integration test: confirm bot `/buy` tx appears in `apps/api` trade history within 60s (Ponder indexing latency). Check `GET /api/v1/bot/positions/:wallet` reflects the new position with cost basis equal to the gross USDC spent (i.e. bot fee included). Check `GET /api/v1/bot/referrals/:wallet` for the referrer reflects an incremented `lifetimeEarnedUsdc` matching the on-chain `ReferralPaid` event.

---

## Deferred features

Each of these was in an earlier draft of this spec and was cut because shipping it would require new work in `apps/api` (or, in two cases, in `apps/web`) that does not exist today. They are listed here so the eventual follow-up is unambiguous about what `apps/api` must expose first. **Do not implement any of these in the bot before the upstream endpoint lands** — partial implementations that store state only in bot KV will diverge from web and become migration debt.

| Bot feature | Blocked on | Notes |
|---|---|---|
| `/portfolio` (24h / 7d / 30d / all timeframes, realised PnL, fees paid, best/worst trade, win rate) | `GET /api/v1/portfolio/:wallet/summary?timeframe=…` + `GET /api/v1/trades/wallet/:wallet` + indexer wallet-summary counter | Two new endpoints plus an indexer-side counter table (analogue of `walletPosition`). v1 only ships all-time PnL via /positions; multi-timeframe aggregates and best/worst-trade analytics are out of scope. |
| `/snipe` (target by contract / deployer / pair / keyword, risk filters, auto-sell) | `CRUD /api/v1/orders/snipe` (authenticated via the bot's existing `X-API-Key` plus an `ownerWallet` body field — same `apiKeyAuth` middleware as today, no new internal-secret scheme) + `SnipeKeeperDO` consuming `WS /ws?channel=newToken` | Snipes must persist in `apps/api` so they survive bot restarts and so web can later display them. Keeper DO is bot-side but depends on the api WS feed. |
| `/copytrade` (mirror trades from a tracked wallet) | `CRUD /api/v1/copytrade` + `CopyKeeperDO` consuming `WS /ws?channel=trade` | Same rationale as `/snipe`. |
| `/orders` (limit / DCA / TP-SL on positions) | `CRUD /api/v1/orders/limit` + `CRUD /api/v1/orders/dca` | TP/SL buttons on `/positions` are also gated on this. |
| `/track <wallet>` (wallet activity) | `GET /api/v1/trades/wallet/:wallet` | Indexer already keys `routerTrades` by `trader`; this is a new GraphQL filter, not new indexing. v1 `/track` accepts a token address only. |
| Price + graduation alerts (on `/track`, on `/settings → Notifications`) | `CRUD /api/v1/alerts` + a keeper subscribing to `WS /ws?channel=price` and `channel=graduation` + `BroadcastDO` for 30 msg/sec throttling | Alerts must persist in `apps/api` so they survive bot redeploys and so web can later show them. |
| Privy ↔ custodial wallet bridge UX | `apps/web` Privy export path | `/wallet`-import wizard's "Import from Web App" copy must match the actual Privy export flow the web app exposes. Bot import already accepts a raw private key; the deferred work is the web-side export UX and matching docs. |
| `/deposit` from Solana (and other non-EVM chains) | Third-party bridge integration (Jumper / deBridge / Mayan deeplink at minimum, programmatic SDK in a later tier) + HyperEVM balance polling for arrival detection + auto-gas-buy of a small USDC → HYPE on arrival | Three implementation tiers exist (deeplink-to-widget, programmatic SDK with custodial Solana wallet, custom solver). v1 ships none of them — users fund the bot wallet with USDC + HYPE on HyperEVM only, by sending to their custodial bot address. Add when conversion data shows the on-chain-only flow is friction. |

When `apps/api` ships an endpoint from this list, the matching follow-up PR must (a) restore the relevant command spec to this file, (b) restore the relevant DO infrastructure (keeper / broadcast) if applicable, and (c) update the corresponding entry in `apps/api/AGENTS.md` so the cross-app contract stays in sync.
