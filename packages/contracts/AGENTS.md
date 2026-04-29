# packages/contracts

Forked from Virtuals Protocol `contracts/fun`. Solidity 0.8.x, Foundry.

## What This Package Does

Bonding curve system where the reserve asset is a BounceTech Leveraged Token (LT) instead of USDC. Users interact via `Zap` which abstracts LT — they only see USDC in/out.

```
User → USDC → Zap → mint LT → Bonding.buy(..., trader=user) → Pair (token/LT) → token
Graduation → Bonding._graduate() → HyperSwap V2 pool (token/LT) → LP locked
```

For the LT interface and constraints (atomic-redeem-only, idle USDC buffer, `$10` minimum) see the BounceTech LT Integration section in the root [`AGENTS.md`](../../AGENTS.md#bouncetech-lt-integration). External references: [BounceTech docs](https://docs.bounce.tech/), [integration guide](https://docs.bounce.tech/technical/integration-guide), [contract source](https://github.com/bounce-tech/bounce-smart-contracts).

## Router allowlist (`Bonding.isRouter`)

`Bonding.launch`, `Bonding.buy`, and `Bonding.sell` are gated on an allowlist:
only addresses in `_routers` (OZ `EnumerableSet.AddressSet`) may call them.
Manage via owner-only `addRouter` / `removeRouter`; query via `isRouter` or
`getRouters`. This (a) makes `Zap` the only trust-surface for
curve interactions, and (b) lets us hot-swap routers without downtime —
`addRouter(newRouter)` → flip the frontend constant → `removeRouter(oldRouter)`.

`Bonding.buy/sell` take a `trader` address which is emitted in `Bonding.Trade`
and used by the indexer / UI. Because only allowlisted routers can reach the
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

## Graduation — Two-Phase, Dynamic LP Seeding (Read This Before Touching Graduation Code)

This is the most bespoke piece of the protocol. Full rationale + invariants live in [`docs/contracts-scope.md`](../../docs/contracts-scope.md#graduation); the short version:

- **Two-phase split.** Graduation is split across two transactions to fit HyperEVM's small-block (~2M gas) ceiling.
  - **Phase 1: `_enterGraduating`**, fired inline by the threshold-crossing buy (~150-200k of additional gas on top of the buy). Drains the curve, computes the LP-bound amounts, caches them in `pendingGraduation[token]`, flips `lifecycle: Curve → Graduating`, freezes trading. Emits `TokenGraduating`.
  - **Phase 2: `finalizeGraduation`**, **permissionless** big-block tx (~2.5M gas). Creates the HyperSwap pair if needed, mints LP via direct `pair.mint(lpLock)` (router-bypass), locks LP, flips `lifecycle: Graduating → Graduated`. Emits `TokenGraduated`. A Cloudflare Worker keeper handles the happy path; anyone can call to rescue a stuck token.
- **Brick resistance.** The phase-2 LP-seeding path bypasses the HyperSwap V2 router entirely (`pair.mint(lpLock)` directly). This makes the contract **immune to a front-runner pre-creating + dust-seeding the pair between phases** — under the previous `_requirePairEmpty` design that scenario was a permanent brick. Tested by `test_brick_resistance_frontRun_dust_seed` in [`test/TwoPhaseGraduation.t.sol`](test/TwoPhaseGraduation.t.sol).
- **Virtual token reserve.** At launch, `Pair.reserve0 = totalSupply (1B)` while only `curveSupply = 75%` (750M) of real tokens are transferred to the pair. The other 250M (`LP_RESERVE`) sit in `Bonding` for graduation. This extends the curve beyond the sellable supply, which is what makes dynamic LP seeding work cleanly.
- **Dual trigger.** Phase 1 fires on whichever hits first: `assetBalance × exchangeRate ≥ $12K` (USD, for LT pumps) or `IPair.tokenBalance() == 0` (supply, for flat/bear markets).
- **Zero-gap LP seeding.** `_prepareGraduationLiquidity` computes `tokensForLP = ltFromPair × reserve0 / reserve1` at end-of-phase-1 and caches the result. Phase 2 uses the cached value verbatim, so the curve→LP price match is invariant under the tx split.
- **Parabola invariant.** With `V_t_init = totalSupply` and `curveSupply = 75%`, the function `tokensForLP(sold) = sold·(S−sold)/S` peaks at `S/4 = LP_RESERVE`. The cap in `_prepareGraduationLiquidity` is defensive — it can never bind in normal operation.
- **Overflow buy cap.** `Router.buy` caps `tokensOut` at the pair's real balance and back-calculates the LT consumed, so the last buy cannot exceed remaining supply. `Zap.buy` refunds the unused LT as USDC (or LT on fallback). `Bonding.buy` returns `(tokensOut, amountInUsed)` for this reason.

**If you change `_enterGraduating`, `finalizeGraduation`, `_prepareGraduationLiquidity`, `_seedHyperswapDirect`, `Router.buy`'s capping logic, or the seeding in `_deployAndSeed`:** you MUST re-run `test/GraduationInvariants.t.sol` AND `test/TwoPhaseGraduation.t.sol`. All 7 zero-gap invariants must still pass; the phase-1-fits-in-small-block budget assertion (1.8M) must still hold; the brick-resistance tests must still pass. These invariants are the product — do not loosen their assertions to make a change go green.

## Functional Spec

Full requirements (buy/sell flows, graduation, events, fee structure): [`docs/contracts-scope.md`](../../docs/contracts-scope.md).

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
- **`--legacy` is NOT needed.** HyperEVM supports EIP-1559; the past broadcasts in `broadcast/Deploy.s.sol/999/` confirm this. The `EIP-3855 not supported` warning forge prints is harmless for our contract set.
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

