# apps/telegram-bot

Telegram trading bot for Alt Fun. Users buy/sell tokens on HyperEVM bonding curves and post-grad HyperSwap pools, manage custodial wallets, and view positions — all from Telegram chat.

**v1 scope is intentionally narrow:** features that would require new endpoints in `apps/api` (snipe orders, copy-trade rules, limit/DCA orders, price/graduation alert subscriptions, wallet tracking, multi-timeframe portfolio aggregates) are **deferred**. The bot ships only what the existing `apps/api` surface and direct HyperEVM RPC already support. When `apps/api` adds an endpoint, the matching command lands in a follow-up — see *Deferred features* near the end of this doc.

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
    onboarding.ts        — OnboardingDO (Durable Object for strongly-consistent /start profile creation)
```

Data flow: Telegram webhook → Cloudflare Worker → command handler → `api.ts` (reads Alt Fun API + Ponder) or `rpc.ts` (on-chain reads/writes) → formatted reply.

Custodial wallets: private keys encrypted with AES-256-GCM using a per-user key derived from `MASTER_KEY` + `userId`. Stored in Cloudflare KV. PIN is required before any key exposure or withdrawal. This is the standard Telegram trading bot model (Bonkbot, Trojan, etc.) — non-custodial is a future option via WalletConnect deep-link.

Integration: all off-chain data comes from `apps/api` (token list, trades, portfolio, prices). On-chain writes (buy/sell/withdraw) are signed by the custodial key and submitted via `rpc.ts` directly to HyperEVM. The bot does **not** run keepers, broadcast queues, or persistent order books in v1 — those land when `apps/api` exposes the corresponding endpoints (see *Deferred features*).

See [apps/api/AGENTS.md](../api/AGENTS.md) for the REST endpoints this bot consumes. See [root AGENTS.md](../../AGENTS.md) for token lifecycle, fee model, and contract addresses.

---

## API surface consumed from apps/api

The bot consumes only endpoints `apps/api` already exposes today. No new api work is required for v1.

| Endpoint | Bot usage |
|---|---|
| `GET /api/v1/tokens/:addr` | Token card on `/buy`, `/sell`, `/track` — name, mcap, `curveFilled`, `curveFilledOrganic`, `curveFilledLeverageBoost`. Mirrors the web row exactly. |
| `GET /api/v1/chart/:address` | Candle snapshot for `lib/chart.ts` — returns `candles[]`, `currentRatio`, `currentExchangeRate`. **Canonical chart endpoint shared with the web app's `fetchChart` in `apps/web/src/services/api.ts`.** The older `/trades/ohlcv/:address` route also exists but does not return `currentRatio` / `currentExchangeRate`, which are required for the in-progress candle to track the live LT rate; use `/chart` everywhere. |
| `GET /api/v1/trades/:address` | Per-token trade history for `/track <contract>` (last N trades). |
| `GET /api/v1/portfolio/:wallet` | Open positions (balance + cost basis). |
| `GET /api/v1/balances/:wallet` | **Indexed Alt Fun token balances only** — returns `{address, name, ticker, ltPair, leverage, balance, …}` per held token. Does *not* return native HYPE or USDC. For HYPE / USDC the bot reads `balanceOf` directly via `rpc.ts` (multicall) — see `/wallet` balance display. |
| `GET /api/v1/referrals/:wallet` | Referred wallets + earned volume for `/referral`. Wallet-keyed — see *Referral identifier bridge* in Key Constraints. |
| `GET /api/v1/stats` | Platform stats for `/help` and ambient context. |

**No WebSocket consumption in v1.** Live `trade` / `price` / `graduation` / `newToken` feeds would only be useful for snipe / copy-trade / alert features, all of which are deferred. The bot is purely request/response.

**Auth model — bot uses a dedicated API key, not a magic internal secret.** `apps/api` applies `apiKeyAuth` middleware to every `/api/v1/*` route (see `apps/api/src/index.ts` `app.use("/api/v1/*", apiKeyAuth)` and `apps/api/src/middleware/api-key-auth.ts`). The middleware understands exactly one auth header — `X-API-Key`, validated against the `apiKeys` table. There is **no** `API_INTERNAL_SECRET` short-circuit and **no** service-binding bypass: requests over a service binding land on the same fetch handler with the same middleware as public traffic, and `CF-Connecting-IP` resolves to the bot Worker's egress identity rather than the end user's. If the bot sends no `X-API-Key`, it gets bucketed under the anonymous per-IP ceiling (240/min) keyed on that single Worker IP — every user shares one bucket and the bot starves itself within a few concurrent commands. Provision one dedicated `apiKeys` row for the bot (rate-limit sized for fleet aggregate, not per-user) and ship the value as a Worker secret. Treat the binding as a latency optimisation, not an auth bypass. If a write surface ever lands (deferred features), it must be a real authenticated route on `apps/api` keyed on `(apiKey, wallet)`, not an `X-Bot-Internal` shared secret.

**Service binding scope.** The bot binds to `apps/api` for zero-egress latency on every read above. The binding does not change auth or rate limiting — every bound call still hits `apiKeyAuth` and counts against the bot's `X-API-Key` quota. It **does** bypass the Cloudflare edge cache (bound traffic lands directly on the api's fetch handler, never on a CDN colo), so the 15–30 s `s-maxage` on aggregate routes does nothing for the bot — assume each bound call costs one full Worker invocation on the api side and rely on the indexer-side O(1) counters rather than edge caching for latency.

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
Effects: create user profile in KV if missing; record referrer if deeplink present
```

Referral deeplink: `t.me/<botname>?start=ref_<referrerUserId>`. Record referrer on first `/start` only — subsequent `/start` calls for existing users must not overwrite the referrer.

**Strong consistency via Durable Object.** Profile creation and referrer recording go through `OnboardingDO` (one DO instance per `userId`, named `idFromName(userId)`), not raw KV. Cloudflare KV is eventually consistent — under concurrent `/start` spam, a raw KV `get-then-put` can double-create profiles or double-record referrers. The DO's single-threaded alarm model serialises all writes for a given user. This is the same pattern as `WsIpLimiter` in `apps/api`.

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
| Withdraw | Alias to `/withdraw` flow | PIN + confirm |

Balance display: native HYPE and USDC are read via `rpc.ts` multicall (`eth_getBalance` + `USDC.balanceOf`) — they are **not** in `GET /api/v1/balances/:wallet`, which returns indexed Alt Fun token balances only. Render native HYPE (RPC) + USDC (RPC) + token positions (`/balances` enriches with `name` / `ticker` / `ltPair`).

### /buy

```
Input:
  required: <contract_address> or alt.fun URL
  optional: <amount_in_usdc>, slippage=<bps>, priority=<gwei>

Output:
  - Static chart image (24h candles, rendered via lib/chart.ts from GET /api/v1/chart/:address, sent as Telegram photo)
  - Token card caption (name, ticker, mcap, curve fill %, 24h change, leverage boost indicator)
  - Risk summary (leverage level, vol decay warning if 5x LT)
  - Quick-amount buttons: $20 | $50 | $100 | Custom
  - Confirm button (if confirmations enabled in /settings)

Effects (after confirmation):
  - Check user USDC balance ≥ (buy amount + gas estimate); surface "Insufficient USDC" if not
  - Resolve USDC allowance for the Zap contract:
      • If allowance < amount and the USDC token supports EIP-2612 permit, sign a permit
        (no extra on-chain tx) and route through `Zap.buyWithPermit`.
      • Otherwise (permit signature fails, or pre-permit token), submit an `approve(maxUint256)`
        tx first and route through `Zap.buy`. Same fallback ladder as web — see
        `apps/web/src/hooks/useTradeRouter.ts` `executeBuy`.
  - Derive slippage bound: call `eth_call` simulation of `Zap.buy[WithPermit]`
    with `minTokensOut = 0` to get a `quotedTokensOut`. Compute
    `minTokensOut = quotedTokensOut * (10_000 - slippageBps) / 10_000` and submit
    the real tx with that bound. **Never submit with `minTokensOut = 0` — that's a
    fully-sandwichable trade.** This matches the web flow exactly.
  - Estimate gas via `estimateContractGas` and submit with a 1.3× buffer.
  - Show tx hash + explorer link; on receipt, update position cache.

Failure modes specific to buys:
  - LT mint-paused: `Zap.buy` reverts because `lt.mint()` fails. Surface: "Buys paused for this token — BounceTech LT is temporarily mint-paused. Sells still work." Do not surface the raw revert.
  - Slippage exceeded: surface "Price moved — try again or increase slippage in /settings."
  - Minimum buy not met: surface before tx construction, not after revert.
```

Token card format mirrors the web UI: name · ticker · mcap · curve-fill bar · leverage tag.

Slippage default: from `/settings` (default 1%). Priority fee default: from `/settings`.

**Minimum buy: `MIN_USDC_BUY_AMOUNT` from `@launchpad/shared` (currently $20 USDC)** — enforced client-side before tx construction. Import the constant; do not hardcode the number, because the buffer above BounceTech's $10 floor is tuned per-release. Quick-amount buttons start at the minimum (currently $20). Surface error: `` md`Minimum buy is $${MIN_USDC_BUY_AMOUNT} USDC` ``.

### /sell

```
Input:
  required: <contract_address> or <ticker_symbol>
  optional: <percentage>% or <amount_in_tokens>  (default: show picker)

Output:
  - Position summary (token amount, cost basis)
  - Estimated USDC out from simulation (after 0.5% Alt Fun fee + any HyperSwap LP fee post-grad)
  - Quick-sell buttons: 25% | 50% | 75% | 100% | Custom
  - Confirm button (if confirmations enabled)

Effects:
  - Check baseAssetBalance() ≥ sell value; cap and warn if buffer low
  - Resolve token allowance for Zap:
      • If allowance < amount and the token supports EIP-2612 permit, sign permit
        and route through `Zap.sellWithPermit`.
      • Otherwise submit `approve(maxUint256)` then route through `Zap.sell`.
  - Derive slippage bound: simulate `Zap.sell[WithPermit]` with `minUsdcOut = 0` to
    get `quotedUsdcOut`. Compute
    `minUsdcOut = quotedUsdcOut * (10_000 - slippageBps) / 10_000`,
    **then floor at 1 wei** when `quotedUsdcOut > 0` and slippage rounding would drop
    the bound to zero — passing 0 re-opens the unconstrained-execution window the
    bound exists to close. Same as `apps/web/src/hooks/useTradeRouter.ts` `executeSell`.
  - Estimate gas; submit with 1.3× buffer; show receipt.
```

Buffer-limited sells: if `redeem(sellAmount) > baseAssetBalance()`, surface: "Buffer low — max sell now is ~$X. Sell in chunks; buffer replenishes in ~10s." Never silently cap — require user to confirm the reduced amount.

**Minimum sell: `MIN_USDC_SELL_AMOUNT` from `@launchpad/shared` (currently $12 USDC of estimated proceeds)** — checked against `quotedUsdcOut` from the simulation, not against the input token amount. Surface error: `` md`Minimum sell is $${MIN_USDC_SELL_AMOUNT} USDC` ``.

### /positions

```
Input:  optional wallet address (default: active wallet)
Output:
  - List of open positions: token name, amount held, cost basis (USDC)
  - Per-position buttons: [Sell 50%] [Sell 100%] [View Chart]
```

Data source: `GET /api/v1/portfolio/:wallet` — returns balance + cost basis per position. No live PnL or current-price column in v1: the existing endpoint does not return current price, and composing it token-by-token from the bot Worker (one `/tokens/:addr` per holding) would fan out badly under load. Live PnL is **deferred** until `apps/api` exposes an enriched portfolio endpoint — see *Deferred features*.

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
| Default buy amount | $50 USDC | Pre-filled amount on /buy |
| Slippage | 1% | Applied to buy/sell |
| Priority fee | Auto | Extra gwei for faster inclusion |
| MEV protection | On | Route through protected RPC if available |
| Trade confirmations | On | Require explicit confirm button before tx |
| Degen mode | Off | Skip confirmations and risk warnings |
| Anti-phishing phrase | — | Shown in every bot message header |

Notifications (trade fills, TP/SL triggers, graduation alerts) are intentionally absent from v1 — they require either a keeper or alert-subscription endpoint, both deferred. The bot replies inline to every command but does not push unsolicited messages.

Degen mode: disables confirmation steps and risk warnings. Requires explicit opt-in acknowledgement. PIN gates remain active regardless of degen mode.

### /security

```
Output:
  - PIN status (set / not set)
  - Active Telegram sessions
  - Withdrawal lock status
  - Anti-phishing phrase (set / not set)

Actions via inline keyboard:
  - Set PIN / Change PIN (6-digit numeric; bcrypt-hashed in KV)
  - Enable/Disable withdrawal lock (24h cooldown to disable)
  - Set anti-phishing phrase (prepended to every bot message)
  - Revoke all sessions (invalidates all active session tokens)
  - Manage withdrawal address whitelist
```

PIN brute-force protection: 5 wrong attempts → 30-minute lockout. Lockout state stored in KV with TTL.

**PIN reset flow (forgotten PIN).** Without a reset path, a forgotten PIN permanently locks a user out of their funds. Reset is available via [Reset PIN] in `/security` and works as follows:

1. User requests reset → bot records a `pin_reset_requested_at` timestamp in KV and sends confirmation message: "PIN reset requested. For security, your reset will be available in 24 hours."
2. During the 24-hour window, all PIN-gated actions remain locked. The delay gives the user time to revoke the reset if their Telegram account was compromised.
3. After 24 hours, user returns to `/security` → [Complete PIN Reset] → sets a new PIN. Old PIN hash is deleted.
4. Bot sends notification at the start of the window and again when the window opens.

The 24-hour delay mirrors the withdrawal lock cooldown. Do not allow instant reset — a stolen Telegram session + instant reset = full funds drain.

### /referral

```
Output:
  - Referral link: t.me/<botname>?start=ref_<userId>
  - Referred users: N
  - Earned fees: $X USDC (pending payout — v2)
  - Referral tier: Standard | Silver | Gold
```

v1 tracking only — same model as web referrals (see [root AGENTS.md](../../AGENTS.md#referrals)). Fee payouts deferred to v2.

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
| Onboarding consistency | Cloudflare Durable Objects | `OnboardingDO` — one DO per userId; serialises profile creation and referrer recording |
| Chart renderer | Worker (WASM) | `lib/chart.ts` — SVG built from the `/api/v1/chart/:address` candle snapshot, converted to PNG via `@resvg/resvg-wasm`; no external service |
| Alt Fun API | `apps/api` (Cloudflare Workers) | Internal service binding (zero egress latency) |
| Blockchain RPC | Alchemy (HyperEVM) | Same `HYPEREVM_RPC_URL` secret as `apps/api` |
| Telegram webhook | Telegram Bot API | Registered via `POST /setWebhook` on deploy |

No keeper or broadcast Durable Objects in v1. Snipe / copy / alert features that would require them are deferred until `apps/api` exposes the matching order / alert endpoints — see *Deferred features*. `OnboardingDO` is the only DO the bot owns.

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

Cloudflare Workers (same account as `apps/api`). Deployed via `wrangler deploy`. On deploy, a post-deploy script registers the webhook:

```sh
curl -X POST "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook" \
  -d "url=https://telegram-bot.<subdomain>.workers.dev/webhook" \
  -d "secret_token=${WEBHOOK_SECRET}"
```

No persistent process — stateless webhook handler. `OnboardingDO` is the only Durable Object and is instantiated lazily on first `/start` per user; no deploy-time kick required.

### Secrets (set via `wrangler secret put`)

| Secret | Purpose |
|---|---|
| `BOT_TOKEN` | Telegram Bot API token from BotFather |
| `MASTER_KEY` | AES-256-GCM master encryption key for custodial wallets — 32 bytes, base64-encoded. **Rotating this invalidates all stored wallets.** No re-encryption migration exists in v1. Treat as a root CA key. |
| `WEBHOOK_SECRET` | Validated on every incoming Telegram request (`X-Telegram-Bot-Api-Secret-Token`) |
| `HYPEREVM_RPC_URL` | Alchemy HyperEVM endpoint (same value as `apps/api`) |
| `API_KEY` | Dedicated `X-API-Key` for the bot's calls to `apps/api`. Provisioned via the `apiKeys` table with a fleet-aggregate rate limit (the bot fans many users through one Worker IP, so the anonymous 240/min ceiling would starve under any real load). Rotate by issuing a new row, redeploying with the new secret, then deactivating the old row. |

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
- **Permit-first, approve as fallback.** Default to `Zap.buyWithPermit` / `sellWithPermit` for any token whose `permit` signature succeeds — the bot holds the private key, so signing EIP-2612 has zero UX cost and saves a tx. Fall back to legacy `approve(maxUint256)` + plain `buy` / `sell` only when permit signing throws (pre-permit token vintage). Match the try/catch ladder in `apps/web/src/hooks/useTradeRouter.ts`.
- **Fees unchanged from web.** 0.5% Alt Fun fee on every buy/sell, curve and post-grad alike. HyperSwap LP fee (0.3%) also applies post-grad.
- **Degen mode does not bypass PIN.** Only skips UI confirmation steps and risk-warning copy.
- **Referrals v1: tracking only.** No on-chain fee split yet.
- **Referral identifier bridge.** The web app keys referrals by wallet address — `useReferral.ts` reads `?ref=<wallet>` from the URL, stores it in `sessionStorage`, and passes it as the `referralCode` arg on `Bonding.buy`. The bot's deeplink is `t.me/<botname>?start=ref_<telegramUserId>`, which is a different namespace. On `/start` with a referral parameter, the bot must resolve `ref_<userId>` → that user's primary custodial wallet via `OnboardingDO`, then persist the resolved *wallet address* (not the userId) as the new user's referrer. Every subsequent bot-submitted buy passes that wallet as `Zap.buy(referralCode)` — interoperability with web referral payouts depends on this translation happening exactly once at onboarding. Edge cases: (a) referrer has no custodial wallet yet (Telegram-only user who hasn't run `/start`) → drop the deeplink silently, log a warning, do not retro-link when the referrer later onboards; (b) the referrer's primary wallet is later switched via `/wallet` → the stored referrer wallet does **not** update, matching the contract's immutable-after-first-buy semantics.

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
  onboarding.ts           — OnboardingDO: strongly-consistent profile creation and referrer recording
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
      start.test.ts
      positions.test.ts
      track.test.ts
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
- Decrypting with wrong `MASTER_KEY` throws
- KV write failure on `saveWallet` propagates as thrown error (not silent)

**`lib/pin.test.ts`**
- Correct PIN verifies successfully
- Wrong PIN increments attempt counter
- 5 wrong attempts sets lockout TTL in KV
- Attempt during lockout rejects immediately without checking hash
- Successful PIN clears attempt counter

**`lib/format.test.ts`**
- MarkdownV2 escaper escapes all reserved chars: `. - ( ) ! + = # > { }`
- Token card truncates name/ticker to fit within 4096-char message budget
- Signed-number formatter renders positive amounts with `+` prefix and negative with `−`, with a colour/indicator hint suitable for cost-basis deltas (v1 does not display live PnL — that test lands with the enriched portfolio endpoint, see *Deferred features*)
- Long position lists split into chunks ≤ 4096 chars each

**`commands/buy.test.ts`**
- Amount below `MIN_USDC_BUY_AMOUNT` (read from `@launchpad/shared`) → error reply, no simulation, no tx constructed
- Valid contract address → token card rendered with name, mcap, curve fill
- LT mint-paused → "Buys paused for this token" reply, no raw revert exposed, no tx constructed
- Confirm button with expired nonce → no-op (no tx submitted)
- Confirm button with valid nonce → simulation runs, `minTokensOut` derived from quote and slippage, real tx submitted with that bound (never `minTokensOut = 0`)
- Permit branch: token supports EIP-2612 → `buyWithPermit` path taken, no separate approve tx
- Approve branch: permit signing throws → `approve(maxUint256)` submitted, then plain `buy`
- Degen mode bypasses confirm step and goes straight to simulation+tx (still derives slippage bound)
- `apps/api` 503 → "Data temporarily unavailable" reply, no crash

**`commands/sell.test.ts`**
- Sell 50% of position → correct token amount computed as `tokenAmount × 0.5`, where `tokenAmount` is the live indexed balance from `GET /api/v1/portfolio/:wallet` (sourced from `tokenBalance` per `apps/api/src/routes/portfolio.ts`). Never compute the sell size from `walletPosition.costBasisUsdc` — that field is cost basis in USDC and has no meaningful unit relationship to the token amount being sold.
- Sell 100% → full position submitted
- Simulation drives `minUsdcOut`: quote × (10_000 − slippageBps) / 10_000; floor at 1 wei when quote > 0 and result would round to 0
- Estimated proceeds below `MIN_USDC_SELL_AMOUNT` → error reply, no tx constructed (the check runs against quoted USDC out, not the input token amount)
- Buffer < sell value → surface max available, require reduced-amount confirm
- Permit branch: token supports permit → `sellWithPermit` path taken
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
- Referral deeplink → referrer recorded on first call only
- Second `/start` → does not overwrite referrer or existing profile

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

Integration test: confirm bot `/buy` tx appears in `apps/api` trade history within 60s (Ponder indexing latency). Check `GET /api/v1/portfolio/:wallet` reflects the new position.

---

## Deferred features

Each of these was in an earlier draft of this spec and was cut because shipping it would require new work in `apps/api` (or, in two cases, in `apps/web`) that does not exist today. They are listed here so the eventual follow-up is unambiguous about what `apps/api` must expose first. **Do not implement any of these in the bot before the upstream endpoint lands** — partial implementations that store state only in bot KV will diverge from web and become migration debt.

| Bot feature | Blocked on | Notes |
|---|---|---|
| `/positions` with live PnL & current price | `GET /api/v1/portfolio/:wallet/enriched` joining `tokenBalance` ⋈ `walletPosition` ⋈ live token price on the indexer side | Same counter-backed pattern as the issue #397 aggregate routes. v1 ships balance + cost basis only. |
| `/portfolio` (24h / 7d / 30d / all timeframes, realised PnL, fees paid, best/worst trade, win rate) | `GET /api/v1/portfolio/:wallet/summary?timeframe=…` + `GET /api/v1/trades/wallet/:wallet` + indexer wallet-summary counter | Two new endpoints plus an indexer-side counter table (analogue of `walletPosition`). |
| `/snipe` (target by contract / deployer / pair / keyword, risk filters, auto-sell) | `CRUD /api/v1/orders/snipe` (authenticated via the bot's existing `X-API-Key` plus an `ownerWallet` body field — same `apiKeyAuth` middleware as today, no new internal-secret scheme) + `SnipeKeeperDO` consuming `WS /ws?channel=newToken` | Snipes must persist in `apps/api` so they survive bot restarts and so web can later display them. Keeper DO is bot-side but depends on the api WS feed. |
| `/copytrade` (mirror trades from a tracked wallet) | `CRUD /api/v1/copytrade` + `CopyKeeperDO` consuming `WS /ws?channel=trade` | Same rationale as `/snipe`. |
| `/orders` (limit / DCA / TP-SL on positions) | `CRUD /api/v1/orders/limit` + `CRUD /api/v1/orders/dca` | TP/SL buttons on `/positions` are also gated on this. |
| `/track <wallet>` (wallet activity) | `GET /api/v1/trades/wallet/:wallet` | Indexer already keys `routerTrades` by `trader`; this is a new GraphQL filter, not new indexing. v1 `/track` accepts a token address only. |
| Price + graduation alerts (on `/track`, on `/settings → Notifications`) | `CRUD /api/v1/alerts` + a keeper subscribing to `WS /ws?channel=price` and `channel=graduation` + `BroadcastDO` for 30 msg/sec throttling | Alerts must persist in `apps/api` so they survive bot redeploys and so web can later show them. |
| Privy ↔ custodial wallet bridge UX | `apps/web` Privy export path | `/wallet`-import wizard's "Import from Web App" copy must match the actual Privy export flow the web app exposes. Bot import already accepts a raw private key; the deferred work is the web-side export UX and matching docs. |

When `apps/api` ships an endpoint from this list, the matching follow-up PR must (a) restore the relevant command spec to this file, (b) restore the relevant DO infrastructure (keeper / broadcast) if applicable, and (c) update the corresponding entry in `apps/api/AGENTS.md` so the cross-app contract stays in sync.
