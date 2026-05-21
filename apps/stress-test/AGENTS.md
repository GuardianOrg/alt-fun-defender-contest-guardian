# apps/stress-test

Standalone Node.js CLI for stress-testing Alt Fun end-to-end. Runs from a single funded wallet against any environment (localhost / staging / prod) and exercises the full launch + trade path — image moderation, R2 upload, vanity mining, on-chain `Zap.createToken`, the off-chain registration endpoint, and the immediate sell-back-to-USDC that keeps the wallet's capital free.

**Not deployed.** This is a developer / SRE tool, not a Worker. It runs locally via `tsx`, sleeps when idle, and produces a per-scenario summary on stdout.

## Scenarios

| Name | What it does | Primary stress targets |
|---|---|---|
| `create-tokens` | Launches N tokens (image → vanity mine → `Zap.createToken` with `$20` seed → optional immediate sell). | Image moderation pipeline, R2 throughput, indexer back-pressure on `TokenCreated`, home-page list / search queries against a growing catalogue. |
| `trade-token` | Hammers a single token with randomised buys + sells from one wallet. Reads fresh balances, picks BUY / SELL based on `--bias`, picks amount in `[--buy-min, --buy-max]` USDC or `[--sell-frac-min, --sell-frac-max]` of the wallet's holdings. Submits with `min*Out = 0` (no MEV protection — this is a stress test, not a user flow). | Curve / post-grad AMM math, indexer `Trade` write path, trade-feed WebSocket fan-out (one DO shard + global), `s-maxage`-cached aggregate routes (`/trades`, `/holders`, `/portfolio`), chart live-tick bucketing. |

Both scenarios share the same `Scenario<TOptions>` interface, the same `NonceManager`, and the same iteration-line visual treatment. Adding a third scenario is a single file + one line in `scenarios/index.ts` — see the "Adding a new scenario" section below.

## What this app exists to catch

The product surfaces a lot of integration boundaries (Privy → Zap → Bonding → Pair → Router → Ponder → API → R2 → DO WebSockets → BounceTech LT) and bugs cluster at the joins. Manually creating five tokens never finds them; throwing 200 at the system in 30 minutes routinely does. We use it for:

- Indexer back-pressure under burst writes.
- API rate limits + per-IP quotas misfiring under realistic creator velocity.
- R2 + moderation pipeline behaviour at sustained throughput.
- Frontend list / search / chart degradation as the token catalogue grows.
- Vanity-mining UX latency under different wallet hardware.
- Any "works for one, breaks for ten" race we can flush out before mainnet load arrives.

## Layout

```text
src/
  index.ts                 CLI entry — argv → scenario dispatch
  config.ts                env loading + chain/contract config
  runner.ts                Generic concurrent runner with metrics + reporter
  lib/
    logger.ts              Human-friendly stdout + JSON debug log (stderr)
    clients.ts             viem public + wallet clients bound to the funded key
    nonce-manager.ts       Hand-rolled nonce serialiser shared by every scenario
    approvals.ts           ensureAllowance — generic ERC-20 approve helper
    cli-args.ts            Typed flag-value parsers (int, float, address)
    format.ts              USDC / HYPE / fraction formatters
    names.ts               Adjective + noun random token name/ticker/description
    images.ts              Random unique PNGs fetched from picsum.photos
    vanity.ts              Async vanity miner (dispatches to worker thread)
    vanity-core.ts         Pure mining loop (used in main + worker threads)
    vanity-worker.ts       node:worker_threads entrypoint
    lts.ts                 BounceTech LT discovery + mint-paused filter
    api-client.ts          Upload image + register token (Alt Fun API)
  scenarios/
    types.ts               `Scenario` interface — extension point
    index.ts               Scenario registry
    create-tokens.ts       Launch token + immediate sell, repeats N times
    trade-token.ts         Randomised buys + sells against one token, as fast as possible
```

## Adding a new scenario

The runner is scenario-agnostic. To add another stress test (e.g. "saturate trade volume on a single token", "graduate N tokens in parallel"):

1. Create `src/scenarios/<name>.ts` exporting an object that satisfies the `Scenario` interface in `scenarios/types.ts`:
   - `name: string` — kebab-case CLI identifier.
   - `description: string` — surfaced by `--help`.
   - `parseOptions(argv: string[]): TOptions` — narrow the bag of CLI flags into a typed options object.
   - `run(ctx: ScenarioContext, options: TOptions): Promise<ScenarioResult>` — actually do the work, returning per-iteration metrics for the reporter.
2. Register it in `scenarios/index.ts`.
3. Done — no changes to `runner.ts`, `index.ts`, or the logger.

The runner is deliberately not a "framework". Each scenario owns its own loop and decides whether to fan iterations out concurrently or run them serially — this keeps the `Scenario` shape thin and avoids us inventing a configuration DSL.

## Wallet, capital, and gas

The runner uses a **single funded wallet** for every signing operation. Manual nonce management mirrors `apps/api/src/lib/auto-graduation-buyer.ts` — viem's pending-nonce auto-fetch double-counts on rapid back-to-back submits.

Capital model for `create-tokens`:

1. Each iteration calls `Zap.createToken` with the on-chain anti-snipe minimum (`MIN_SEED_USDC = $20`).
2. Once the tx confirms, the wallet reads its token balance and immediately calls `Zap.sell` to swap it back to USDC.
3. Total in-flight capital ≈ `$20 × concurrency` plus a few seconds of unwind lag.

Some USDC is lost per iteration to the round-trip fee (0.75% buy + 0.75% sell + ~0.5% LT redeem ≈ `$0.40` per `$20` cycle) and to gas. Budget `~$1` per token plus headroom — for a 1000-token sweep, fund the wallet with `~$1500` and a few dollars of HYPE.

The wallet must:

- Hold enough HYPE for `(createToken + sell) × N` gas. Each launch is ~1.5M gas (Pair clone + Token clone + seed buy + curve trade); each sell is ~250k gas. At HyperEVM's stable gas price this is fractions of a cent each.
- Have approved USDC to `Zap` at `maxUint256`. The runner does this once on startup if the allowance is short — every subsequent iteration skips the approve tx via an allowance pre-read.
- **Not be the deployer key.** Use a fresh hot wallet provisioned with disposable capital — anything the script signs is non-recoverable on revert and a typo in scenario code shouldn't risk a long-lived secret. Same logic as the keeper wallets in `apps/api`.
- **Stay on small blocks** for fast confirms. `createToken` fits comfortably under the ~2M small-block ceiling (Token + Pair are EIP-1167 clones; the heavy weight is the seed buy, not deployment). If the wallet was ever toggled to big blocks for a previous workflow, flip it back with `node packages/contracts/scripts/toggle-big-blocks.mjs off` before running the harness.

## Image pipeline (deliberately stresses dedup + moderation)

Token images are fetched from `picsum.photos`. Each iteration uses a fresh random seed so the bytes (and the perceptual hash if one is ever added) are different — this exists specifically to exercise the moderation pipeline's per-upload path rather than its dedup short-circuit. Picsum is free, has no auth, and serves a real photograph every time, so we also exercise the OpenAI `omni-moderation-latest` round-trip on every iteration.

Failures we expect to surface here:

- The Cloudflare WAF rate-limit rule on `POST /api/v1/images` (5 req/min/IP) tripping under high concurrency. By design — when you see 429s here at high concurrency, the edge rule is working as advertised.
- OpenAI 5xx during sustained traffic — the moderation layer's documented fail-closed behaviour (503 surfaced) is exactly what the harness should observe in that case.
- R2 PUT latency creep as the bucket grows. Visible in the per-iteration `imageUploadMs` histogram.

If the harness ever needs to *avoid* triggering moderation (e.g. you're load-testing only the on-chain side), an `--image=noop` flag would be a clean extension — not implemented today because the moderation path is one of the things we explicitly want to keep in the hot loop.

## Vanity mining runs on `node:worker_threads`

Production `VANITY_SUFFIX` is 5 hex zeros — mean ~1M attempts per mine. viem's pure-JS keccak256 caps a single thread at ~45k attempts/sec, so the mean wall-clock is ~22s per mine.

Critically, **multiple concurrent miners on the same JS thread share that 45k/sec budget**. At `--concurrency 10` each mine drops to ~4.5k attempts/sec, and a single mine takes ~3.5 minutes. The first version of the harness shipped with the loop inline on the main thread and was observably indistinguishable from "stuck" at any concurrency past 2 — see chat history under "Running it but it looks like it's stuck?".

The fix is `node:worker_threads`: each mine dispatches to a dedicated worker spawned per-iteration, so K parallel mines actually run on K cores. On an 8-core MBP that's ~22s per mine even at concurrency 8.

Layout:

- `src/lib/vanity-core.ts` — the pure mining function (`runMiningLoop`). No I/O. Importable from both main thread and worker.
- `src/lib/vanity-worker.ts` — one-shot worker entrypoint. Receives `MineParams` via `workerData`, runs `runMiningLoop`, posts back `{ ok, result | error }`, exits.
- `src/lib/vanity.ts` — public async API. `mineVanitySalt(params)` spawns a Worker via `new Worker(new URL("./vanity-worker.ts", import.meta.url))`, awaits the result, terminates the worker. Also exports `mineVanitySaltSync` for callers that genuinely need a sync result (tests, future CLI smoke).

Per-mine worker-spawn cost is ~50ms — negligible against the mining work itself, so we prefer one-shot workers over a pool. tsx's loader hook propagates to spawned workers, so the `.ts` URL works without a separate build step.

If you ever change `VANITY_SUFFIX` to anything longer than 6 chars, revisit this — past 6 chars the mining work dominates everything else and a more aggressive parallelisation strategy (native keccak via `@noble/hashes` C addon, or splitting one mine across multiple workers) may be worth the complexity.

## LT pool filtering

`loadTradableLTs` in `src/lib/lts.ts` applies two filters in sequence before handing the pool to the scenario:

1. **`filterSupportedLTs` from `@launchpad/shared`** — narrows to Alt Fun's supported asset universe (HYPE, ETH, BTC, …, `xyz:*`) and the 2x/3x/5x leverage tuple. This is the same filter the API and frontend run.
2. **`mintPaused === false`** — every `createToken` iteration runs a mandatory `$20` seed buy which mints LT; a paused LT reverts every iteration. Skipping these keeps the harness producing useful stress signal instead of a 100%-failure log.

If you change these filters, keep the harness's view of "tradable" aligned with what the product actually accepts.

## Anti-snipe / trading delay

`Bonding.LAUNCH_TRADING_DELAY_BLOCKS = 3` — public buys revert with `TradingNotOpen` until `launchBlock + 4`. Sells are not subject to this gate in the current contract, but the runner sequences `await waitForTransactionReceipt(createTx)` before constructing the sell anyway, so by the time the sell is broadcast the launch block has already finalised and any same-block constraints are moot.

If you change either knob in `Bonding.sol`, the harness needs no changes — the delay is opaque to it; the wait-for-receipt pattern absorbs whatever delay the contract enforces. The on-chain `Zap.MIN_SEED_USDC` floor *is* hard-coded as the seed amount, so a contract change to that value requires bumping `SEED_USD` in `scenarios/create-tokens.ts` to match.

## CI / lint

This app participates in the standard turbo pipeline (`lint`, `typecheck`, `test`, `build`). It does **not** ship a `dev` step into the watch graph because it's a one-shot CLI, not a long-running process; `npm run dev` from inside this app just runs the CLI once.

When editing this app, the standard scope command is:

```sh
npx turbo run lint typecheck test build --filter=@launchpad/stress-test
```

## Safety rails

- **Hard-coded seed minimum.** The script does not parameterise the seed buy amount below the on-chain `MIN_SEED_USDC` floor. Bypassing the floor would make every iteration's first tx revert with `BelowMinSeed` — there's no useful test in that, and exposing the knob would invite misconfiguration.
- **No `--force-image-rejection` flag.** If you want to exercise the moderation-rejection path, point the harness at an image source the moderator scores high — don't ship a flag that skips the upload entirely, that's a different scenario.
- **The runner stops on the first wallet-level failure** (e.g. insufficient USDC, RPC unreachable on the very first tx). Per-iteration failures inside the scenario loop are caught, logged, and accounted for in the summary — they don't abort the sweep.
