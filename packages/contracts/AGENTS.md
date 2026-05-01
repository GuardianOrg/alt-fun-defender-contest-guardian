# packages/contracts

Forked from Virtuals Protocol `contracts/fun`. Solidity 0.8.x, Foundry.

## What This Package Does

Bonding curve system where the reserve asset is a BounceTech Leveraged Token (LT) instead of USDC. Users interact via `Zap` which abstracts LT — they only see USDC in/out.

```
User → USDC → Zap → mint LT → Bonding.buy(..., trader=user) → Pair (token/LT) → token
Graduation → Bonding._graduate() → HyperSwap V2 pool (token/LT) → LP locked
```

For the LT interface and constraints (atomic-redeem-only, idle USDC buffer, `$10` minimum) see the BounceTech LT Integration section in the root [`AGENTS.md`](../../AGENTS.md#bouncetech-lt-integration). External references: [BounceTech docs](https://docs.bounce.tech/), [integration guide](https://docs.bounce.tech/technical/integration-guide), [contract source](https://github.com/bounce-tech/bounce-smart-contracts).

## Two "router" concepts — read this before touching either

The codebase has two distinct things called "router" and they have very different
upgrade properties. Conflating them is a real footgun:

1. **Zap (a.k.a. user-facing router) — hot-swappable.** `Zap` is the entry point
   gated by `Bonding._routers` (OZ `EnumerableSet.AddressSet`). `Bonding.launch`,
   `Bonding.buy`, and `Bonding.sell` revert unless `msg.sender` is on this
   allowlist. Manage via owner-only `addRouter` / `removeRouter`; query via
   `isRouter` or `getRouters`. This list is what the "hot-swap" story refers to:
   `addRouter(newZap)` → flip the frontend constant → `removeRouter(oldZap)`. No
   downtime, no per-token migration. `Zap` itself is also UUPS-upgradeable, so
   small changes can ship via implementation upgrade without touching the
   allowlist at all.
2. **`Router.sol` (AMM math, internal) — frozen at deploy.** This is the
   contract the curve `Pair`s actually call into. `Pair.router` is **immutable**,
   wired in `Pair`'s constructor from whatever `Factory.router` was at
   `Factory.createPair` time. `Factory.setRouter` is also one-shot:
   `if (pairCount > 0) revert RouterFrozen();` — once the first pair is created
   the factory's `router` field is permanent, so every future pair inherits the
   same address. `Router.sol` itself is **not** UUPS-upgradeable (no
   `UUPSUpgradeable` mixin, no `_authorizeUpgrade`, and the deploy script
   instantiates it directly via `new Router()` rather than behind an
   `ERC1967Proxy`). Replacing it therefore requires a fresh `Factory` + fresh
   `Router` + migrating every existing token, which is effectively a re-deploy.
   This is acceptable because `Router` holds no funds and no per-token state —
   it is pure AMM math against `Pair` reserves — but it is not "swappable" in
   any operational sense.

The "router" in the `Bonding._routers` allowlist refers to category (1); a
future rename to `_zaps` would remove the ambiguity but is a coordinated
breaking change (indexer + frontend) and has not been done.

`Bonding.buy/sell` take a `trader` address which is emitted in `Bonding.Trade`
and used by the indexer / UI. Because only allowlisted Zaps can reach the
function, `trader` is trusted — `Zap` forwards `msg.sender` (the
real user EOA). Seed buys via `createToken` attribute to the creator.

## Contracts

| Contract | Description |
|---|---|
| `Bonding.sol` | Launch, buy, sell, graduation (dynamic LP seeding, dual trigger), fee collection |
| `Factory.sol` | Pair registry, fee config (multi-LT via `PairCreated(lt)` + `ltFor` mapping) |
| `Router.sol` | AMM math, buy/sell execution with **overflow buy cap** |
| `Pair.sol` | Per-token pair: reserves, k-constant (asset-agnostic, no changes) |
| `Token.sol` | ERC20 token with owner-only burn |
| `Zap.sol` | USDC abstraction, LT mint/redeem, **overflow-LT refund**, referral events |
| `LPLock.sol` | Graduation LP lock (UUPS, no withdraw in v1) |

## Anti-snipe Launch Gate (Read This Before Touching `launch` or `buy`)

Issue #310. Two cooperating knobs eliminate the standard pump.fun-class first-block snipe:

- `Zap.MIN_SEED_USDC` (`$20`, real USDC, 6dp) — `Zap.createToken` reverts with `BelowMinSeed` for any smaller seed. Mandatory; the seed buy is no longer optional.
- `Bonding.LAUNCH_TRADING_DELAY_BLOCKS = 3` — `Bonding.buy` reverts with `TradingNotOpen` until `block.number > launchBlock + LAUNCH_TRADING_DELAY_BLOCKS`. The seed buy bypasses the gate via a transient-storage slot (`_SEED_BUY_BYPASS_SLOT`, EIP-1153 TLOAD/TSTORE) set in `launch()` and consumed on first match in `buy()`. Bypass is consume-once and naturally cleared at end-of-tx — separate-tx sniper buys at the same block see a cleared slot and revert.

Combined: the creator's seed absorbs the cheap end of the curve, and no public buy can land before `launchBlock + 4`. **No upper bound on the seed.** A cap would be trivially bypassable via a second wallet at `launchBlock + 4` and would block legitimate seed-and-burn patterns; the floor is the only side that protects retail. This is a deliberate design choice — see `Zap.MIN_SEED_USDC` natspec and `Bonding._enforceLaunchDelay`.

If you change either knob, update the threat-model writeup in the root [`AGENTS.md`](../../AGENTS.md#anti-snipe-design) and the frontend mirror (`MIN_USDC_BUY_AMOUNT` in [`packages/shared/src/constants/bouncetech.ts`](../shared/src/constants/bouncetech.ts) plus the disable check in [`apps/web/src/components/create/CreateView.tsx`](../../apps/web/src/components/create/CreateView.tsx)). Coverage: `test_buy_blockedDuringLaunchDelay`, `test_buy_blockedAtLastDelayBlock`, `test_buy_succeedsOnceDelayElapses`, `test_createToken_revertsBelowMinSeed`, `test_createToken_revertsZeroSeed`, `test_launchBlock_recorded` in `test/Zap.t.sol`.

## Graduation — Two-Phase, Dynamic LP Seeding (Read This Before Touching Graduation Code)

This is the most bespoke piece of the protocol. Full rationale + invariants live in [`docs/contracts-scope.md`](../../docs/contracts-scope.md#graduation); the short version:

- **Two-phase split.** Graduation is split across two transactions to fit HyperEVM's small-block (~2M gas) ceiling.
  - **Phase 1: `_enterGraduating`**, fired inline by the threshold-crossing buy (~150-200k of additional gas on top of the buy). Drains the curve, computes the LP-bound amounts, caches them in `pendingGraduation[token]`, flips `lifecycle: Curve → Graduating`, freezes trading. Emits `TokenGraduating`.
  - **Phase 2: `finalizeGraduation`**, **permissionless** big-block tx (~2.5M gas). Creates the HyperSwap pair if needed, mints LP via direct `pair.mint(lpLock)` (router-bypass), locks LP, flips `lifecycle: Graduating → Graduated`. Emits `TokenGraduated`. A Cloudflare Worker keeper handles the happy path; anyone can call to rescue a stuck token.
- **Brick resistance.** The phase-2 LP-seeding path bypasses the HyperSwap V2 router entirely (`pair.mint(lpLock)` directly). This makes the contract **immune to a front-runner pre-creating + dust-seeding the pair between phases** — under the previous `_requirePairEmpty` design that scenario was a permanent brick. Tested by `test_brick_resistance_frontRun_dust_seed` in [`test/TwoPhaseGraduation.t.sol`](test/TwoPhaseGraduation.t.sol).
- **Virtual token reserve.** At launch, `Pair.reserve0 = totalSupply (1B)` while only `curveSupply = 75%` (750M) of real tokens are transferred to the pair. The other 250M (`LP_RESERVE`) sit in `Bonding` for graduation. This extends the curve beyond the sellable supply, which is what makes dynamic LP seeding work cleanly.
- **Dual trigger.** Phase 1 fires on whichever hits first: `(storedAssetReserve - virtualLtReserve) × exchangeRate ≥ $12K` (USD, for LT pumps) or `IPair.tokenBalance() == 0` (supply, for flat/bear markets). The USD trigger reads STORED reserves so direct LT donations to the pair don't count toward the threshold; the launch-time `virtualLtReserve` is recovered on-the-fly as `Pair.k() / Token.TOTAL_SUPPLY()` (K is set once at mint and never modified by `Pair.swap`). The supply trigger reads live `tokenBalance()`, which is donation-resistant in the opposite direction: token donations only INCREASE the balance and can never satisfy `== 0`, and any donated tokens are unconditionally burned by `_prepareGraduationLiquidity`.
- **Zero-gap LP seeding.** `_prepareGraduationLiquidity` computes `ltFromPair = storedAssetReserve - virtualLtReserve` (the real LT raised by the curve, donation-immune; `virtualLtReserve` is derived from `Pair.k() / Token.TOTAL_SUPPLY()`) and `tokensForLP = ltFromPair × storedTokenReserve / storedAssetReserve` at end-of-phase-1, caching the result. Phase 2 uses the cached value verbatim, so the curve→LP price match is invariant under the tx split. Donated LT stays in the curve pair under the trust assumption that `BONDING_ROLE` is only ever held by `Bonding` and `Bonding` won't call `Router.graduate` again post-graduation.
- **Parabola invariant.** With `V_t_init = totalSupply` and `curveSupply = 75%`, the function `tokensForLP(sold) = sold·(S−sold)/S` peaks at `S/4 = LP_RESERVE`. The cap in `_prepareGraduationLiquidity` is defensive — it can never bind in normal operation.
- **Overflow buy cap.** `Router.buy` caps `tokensOut` at the pair's real balance and back-calculates the LT consumed, so the last buy cannot exceed remaining supply. `Zap.buy` refunds the unused LT as USDC (or LT on fallback). `Bonding.buy` returns `(tokensOut, amountInUsed)` for this reason.

**If you change `_enterGraduating`, `finalizeGraduation`, `_prepareGraduationLiquidity`, `_seedHyperswapDirect`, `Router.buy`'s capping logic, or the seeding in `_deployAndSeed`:** you MUST re-run `test/GraduationInvariants.t.sol` AND `test/TwoPhaseGraduation.t.sol`. All 7 zero-gap invariants must still pass; the phase-1-fits-in-small-block budget assertion (1.8M) must still hold; the brick-resistance tests must still pass. These invariants are the product — do not loosen their assertions to make a change go green.

## Functional Spec

Full requirements (buy/sell flows, graduation, events, fee structure): [`docs/contracts-scope.md`](../../docs/contracts-scope.md).

## Comment Style

These contracts will be audited and re-read by adversaries. Auditor attention is a finite resource — every paragraph of natspec is one less paragraph of attention on the next finding. Default to no comment, and earn each one.

**Keep:**

- Security-relevant invariants and the consequences of violating them (e.g. "tokens-for-LP ≤ LP_RESERVE is a mathematical invariant; the cap is a defensive guard").
- Front-run / DoS / MEV rationale (e.g. why a parameter is immutable, why a path bypasses the router, why a `try/catch` defuses a permit grief).
- Cross-system constraints that would break if violated (e.g. "must stay in sync with `vanity.ts`", "frontend / API replicate this length cap pre-flight").
- Numerical-encoding footguns (`uint256` vs `uint128` choices, scaling factors, BPS denominators).
- Non-obvious storage-layout requirements (gap sizing, append-only ordering for upgradeable contracts).
- Anything an auditor would reasonably ask "why this and not the obvious thing?" about.

**Cut:**

- Restatements of the function or variable name (`/// @notice Set the fee-to address`).
- Narration of the next line (`// Pull USDC from the user`).
- Standard pattern references when the code is plainly the standard pattern (don't cite "CEI" before every well-ordered function; don't explain UniswapV2 `transfer → swap` every time it appears).
- Re-derivations of content already in [root `AGENTS.md`](../../AGENTS.md), [`docs/contracts-scope.md`](../../docs/contracts-scope.md), or this file. Link to the canonical source instead.
- Doc strings that just describe what the next struct field obviously holds (`/// @dev The address of the recipient`).
- Per-getter natspec on trivial mappings already documented at the storage-variable declaration.
- "Existence check" / "see X for the rationale" comments that lead a reader through obvious control flow — early-return the obvious revert and trust the error name.

**Style:**

- Contract-level natspec orients a reader (one paragraph: what it is, what's load-bearing, where to look for the deep dive). Don't reproduce the spec.
- One source of truth: if a struct field's natspec already explains a width-choice rationale, the producing function shouldn't repeat it. Either link or stay silent.
- Section banners (`// ─── X ───`) are fine in long files (>300 lines, e.g. `Bonding.sol`, `Zap.sol`); drop them in short files.
- Errors should be self-documenting via their name (`UnknownLeveragedToken`, `LpLockNotConfigured`). Add an `@dev` only when the trigger condition isn't obvious from the name.

## Deploying to HyperEVM

Run from `packages/contracts`. Requires `.env` with `DEPLOYER_PRIVATE_KEY` and `HYPEREVM_RPC_URL`.

```bash
# 1. (one-time per wallet) opt deployer into big blocks — required for anything > ~2M gas
node scripts/toggle-big-blocks.mjs on

# 2. fresh build (avoids stale artifacts after renames/rewrites)
forge clean && forge build

# 3. broadcast — `--slow` is mandatory because txs depend on prior deployments
forge script script/Deploy.s.sol:Deploy --rpc-url "$HYPEREVM_RPC_URL" --broadcast --slow

# 4. (optional but recommended) flip back to small blocks so future config tx's confirm in 1s
node scripts/toggle-big-blocks.mjs off
```

After it completes (`ONCHAIN EXECUTION COMPLETE & SUCCESSFUL.`):

1. Copy the addresses from `== Logs ==` into [`packages/shared/src/constants/addresses.ts`](../shared/src/constants/addresses.ts).
2. Update [`packages/shared/src/constants/chains.ts`](../shared/src/constants/chains.ts) `BONDING_START_BLOCK` to the lowest receipt block from `broadcast/Deploy.s.sol/999/run-latest.json` so the indexer doesn't replay history before our contracts existed.
3. Update the `DEFAULT_BONDING` / `DEFAULT_ZAP` constants in [`script/E2ETest.s.sol`](script/E2ETest.s.sol).
4. Re-export ABIs and rebuild shared so consumers see the new addresses:
   ```bash
   npm run export-abi --workspace @launchpad/contracts
   npm run build --workspace @launchpad/shared
   ```
5. Run `npm run typecheck && npm run lint && npm run test && npm run build` from the repo root.
6. Sanity-check wiring on-chain (see "Post-deploy sanity checks" below).

### HyperEVM gotchas (read this BEFORE deploying)

HyperEVM is **not** a vanilla EVM RPC — these things will burn time if you skip them:

- **Dual block dispatch.** Small blocks ≈2M gas / ~1s, big blocks ≈30M gas / ~60s. `Deploy.s.sol` includes contracts that exceed 2M gas individually (`Bonding`, `Zap`), so the broadcast WILL fail with `error code -32603: exceeds block gas limit` until you opt in. The opt-in is **per-wallet, persists**, lives on the Hyperliquid L1 (NOT EVM), and applies to **every** subsequent tx from that wallet (1s → 60s confirmations). Tooling: `scripts/toggle-big-blocks.mjs` (status / on / off) — uses Hyperliquid's `evmUserModify` L1 action with the `Agent`/phantom-agent EIP-712 signing scheme (NOT the user-signed-action scheme; do not copy from random Hyperliquid SDK examples without reading `sign_l1_action`).
- **Slow broadcasts.** With big blocks on, a full `Deploy.s.sol` is ~14–19 sequential txs × ~60s = **15–20 minutes**. Plan accordingly. Use `--slow` so forge waits for confirmations between dependent txs (it would hit nonce/state mismatches without it).
- **`--legacy` is NOT needed.** HyperEVM supports EIP-1559; the past broadcasts in `broadcast/Deploy.s.sol/999/` confirm this.
- **EVM version is pinned to Cancun.** `foundry.toml` sets `evm_version = "cancun"` to match HyperEVM (Cancun without blobs, per the [Hyperliquid docs](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/hyperevm)). Don't downgrade to Shanghai/Paris — solc would still emit Cancun-safe bytecode, but the explicit pin documents intent and unlocks `MCOPY` / transient storage if a future contract needs them.
- **Verification.** No public Etherscan-equivalent — `forge verify-contract` doesn't apply. `cast call` is the source of truth (see the sanity-check block in the deploy section above).
- **Chain ID is `999`.** RPC: `https://rpc.hyperliquid.xyz/evm` (or any provider; `.env` uses Alchemy).

### Post-deploy sanity checks

These read on-chain state and confirm the wiring set up by `_deploy()` actually landed:

```bash
set -a && source .env && set +a
B=<bonding_proxy>; F=<factory>; R=<router>; Z=<zap_proxy>
cast call --rpc-url "$HYPEREVM_RPC_URL" $B "tokenImplementation()(address)"   # = Token impl
cast call --rpc-url "$HYPEREVM_RPC_URL" $B "factory()(address)"               # = Factory
cast call --rpc-url "$HYPEREVM_RPC_URL" $B "router()(address)"                # = Router
cast call --rpc-url "$HYPEREVM_RPC_URL" $B "isRouter(address)(bool)" $Z       # = true
cast call --rpc-url "$HYPEREVM_RPC_URL" $Z "bonding()(address)"               # = Bonding proxy
cast call --rpc-url "$HYPEREVM_RPC_URL" $F "router()(address)"                # = Router
cast call --rpc-url "$HYPEREVM_RPC_URL" $B "owner()(address)"                 # = deployer
```

