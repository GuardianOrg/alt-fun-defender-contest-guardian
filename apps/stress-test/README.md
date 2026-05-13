# @launchpad/stress-test

Standalone Node CLI that load-tests the Alt Fun stack — token creation, image moderation, indexer, API, and on-chain trading — against any environment (localhost, staging, prod).

For the full functional spec see [`AGENTS.md`](./AGENTS.md). The summary below is just enough to run it.

## Setup

`.env.local` is created automatically by `npm run setup` at the repo root (idempotent — safe to re-run). Open it and fill in:

- `STRESS_TEST_PRIVATE_KEY` — a fresh hot wallet (NOT the deployer).
- `HYPEREVM_RPC_URL` — point at a private Alchemy / Infura RPC; the public node will rate-limit you under concurrency.
- `API_BASE_URL` — `http://localhost:8787` for local, or the deployed Worker URL.
- `STRESS_TEST_API_KEY` — only needed when hitting a deployed API; localhost bypasses auth.

`.env.local` is gitignored. The committed `.env.example` is the schema reference — never edit `.env` by hand, the loader only reads `.env.local`.

Fund the wallet:

- HYPE for gas (a couple of dollars covers thousands of launches).
- USDC for the seed buy + sell round-trip. Each `create-tokens` iteration costs ~`$0.30` in fees + a fraction of a cent in gas. Budget ~`$1` per intended token + headroom.

## Run

```bash
# From this directory:
npm run start -- <scenario> [...flags]

# Or from the repo root via the workspace alias:
npm run start --workspace @launchpad/stress-test -- <scenario> [...flags]
```

### Available scenarios

| Name | One-liner |
|---|---|
| `create-tokens` | Launch N tokens with image upload, vanity mining, on-chain `createToken`, registration, and optional immediate sell. |
| `trade-token` | Trade a single token (random buys + sells, random amounts, optional jitter) from one wallet as fast as the chain + RPC allow. |

Run `--help` after the scenario name to see its flags.

### `create-tokens`

Launches N tokens back-to-back. Each iteration:

1. Picks a random BounceTech LT (HYPE / ETH / BTC / … × 2x/3x/5x long or short).
2. Generates a random name, ticker, and description.
3. Downloads a fresh random image from `picsum.photos`, uploads it through `/api/v1/images` (full moderation round-trip), gets the R2 URL back.
4. Mines a `0x…00000` vanity salt for the predicted CREATE2 address.
5. Calls `Zap.createToken(LaunchParams, $20 USDC)` — atomic launch + seed buy.
6. Registers the new token via `POST /api/v1/tokens`.
7. Reads the token balance and immediately calls `Zap.sell(token, balance, 0)` to free the capital.

```bash
# 50 tokens, one at a time
npm run start -- create-tokens --count 50

# 200 tokens, 4 in flight at once (nonces managed manually)
npm run start -- create-tokens --count 200 --concurrency 4

# Custom seed amount (must be ≥ `$20` — the on-chain MIN_SEED_USDC)
npm run start -- create-tokens --count 10 --seed-usd 25

# Skip the post-launch sell (leaves the capital tied up — useful for
# stressing the trade-feed / chart while tokens sit on the bonding curve)
npm run start -- create-tokens --count 10 --no-sell
```

### `trade-token`

Hammers a single token with randomised buys and sells. Useful for stressing the trade feed, chart, indexer write path, and any `s-maxage` cached API surface that flushes when a trade lands.

```bash
# 200 trades against a specific token, default `$20`-`$50` buys, 10-50% sells
npm run start -- trade-token --token 0xABCD…00000 --count 200

# 4 in-flight at once, buys `$30`-`$100`, jitter 0-500ms between iterations
npm run start -- trade-token --token 0xABCD…00000 \
  --count 500 --concurrency 4 \
  --buy-min 30 --buy-max 100 \
  --max-delay-ms 500

# Buy-only (e.g. drive the bonding curve toward graduation)
npm run start -- trade-token --token 0xABCD…00000 --count 50 --no-sell

# Sell-only (requires pre-existing token balance)
npm run start -- trade-token --token 0xABCD…00000 --count 30 --no-buy
```

### Tips

- Run against `apps/api` locally first to flush out bugs cheaply — `npm run dev` from the repo root, then point `API_BASE_URL=http://localhost:8787` in `.env`. Local mode skips the API-key middleware.
- Against a deployed API, mint a dedicated `apiKeys` row with a generous rate limit and set `STRESS_TEST_API_KEY`. The harness sends it as `X-API-Key` on every request.
- The Cloudflare WAF on `POST /api/v1/images` rate-limits at 5 req/min/IP. At concurrency > 3 against a deployed API you'll see 429s on image upload — that's by design, not a harness bug.

## Adding a scenario

See [`AGENTS.md`](./AGENTS.md#adding-a-new-scenario). Short version: drop a file in `src/scenarios/`, register it in `src/scenarios/index.ts`, done.
