# Launchpad Contracts — Audit Findings

Reviewed against [AUDIT_PRINCIPLES.md](../../../bounce-contracts/audits/AUDIT_PRINCIPLES.md).
Contracts reviewed: `Bonding`, `Factory`, `Router`, `Pair`, `Token`, `Zap`, `FeeVault`, `LPLock`.

---

## H1 — `ltAddress` is permissionless but treated as a trusted BounceTech LT

**Files:** `src/Zap.sol:283-284`, `src/Bonding.sol:330`, `src/Factory.sol:38`, `src/Router.sol:115`  
**Principle:** #1 (Asset Accounting), #8 (Silent External Call Failures), #12 (Deployment Invariants)

`Bonding.launch` accepts any nonzero `ltAddress` with no further validation. The entire system from that point assumes the LT is a well-behaved, 18-decimal, non-fee-on-transfer BounceTech contract whose `mint`, `redeem`, `exchangeRate`, and ERC20 transfers are honest. A malicious or non-standard LT can exploit every place the system trusts it:

| Call site | Assumption | Malicious outcome |
|-----------|------------|-------------------|
| `Zap._executeBuy:283` — `usdc.forceApprove(lt, netUsdc)` then `lt.mint(...)` | LT consumes exactly `netUsdc` USDC | LT drains approved USDC from Zap and returns an arbitrary `ltMinted`, stealing user funds |
| `Router.buy:115` / `Router.sell:161` — `safeTransferFrom(...)` | ERC20 transfer amount equals accounting amount | Fee-on-transfer / rebasing LT causes pair reserves to overstate real balance |
| `Bonding.canGraduate:560` — `lt.exchangeRate()` | Rate reflects real price | LT returns `type(uint256).max` to force instant graduation of any token |
| `_prepareGraduationLiquidity:762` — `router.graduate()` returns raw `assetBalance()` | Balance = organically raised LT | LT mints itself into the pair to distort LP seeding |
| `Zap._sellInternal:347` — `lt.redeem(address(this), ...)` | USDC returned equals LT value | LT returns 0 USDC (or reverts) after burning user's LT, locking value |

The code itself acknowledges "Token creation is permissionless on `Zap.createToken`" (comment at line 172) but treats this purely as an overflow edge-case rather than a security boundary. Any user tricked into trading a token backed by a malicious LT can lose USDC.

**Fix:** Maintain an on-chain LT allowlist in `Bonding` (or a shared registry) and enforce it in `launch`. Only allow known, audited BounceTech LT addresses:
```solidity
mapping(address => bool) public allowedLT;

function launch(LaunchParams calldata params, ...) external ... {
    if (!allowedLT[params.ltAddress]) revert LTNotAllowed();
    ...
}
```

---

## M1 — Sell-side `BelowMinAmount` guard never fires in production

**File:** `src/Zap.sol:342-343`  
**Principle:** #6 (Decimal Scale Mismatch)

```solidity
uint256 grossUsdcEstimate = (ltReceived * ILeveragedToken(lt).exchangeRate()) / 1e18;
if (grossUsdcEstimate < MIN_USDC_AMOUNT) revert BelowMinAmount();
```

`exchangeRate()` returns USD-per-LT in **1e18 scale** — confirmed by `canGraduate`'s graduation threshold math (`graduationThresholdUsd >= 100 ether`). So `grossUsdcEstimate` is 1e18-scale USD. `MIN_USDC_AMOUNT = 10e6` is in 6-decimal USDC (production scale). Any realistic sell (even $0.001 of LT) produces `grossUsdcEstimate` >> `10e6`, so this guard **never fires**.

The guard exists to surface a clean `BelowMinAmount` before the LT's own minimum floor triggers. Without it, a sub-$10 sell falls through to `lt.redeem`, which reverts with a cryptic undecodable error.

**Fix:** Compare against an 18dp constant, or normalize before comparing:
```solidity
// Option A: use an 18dp constant
uint256 constant MIN_USDC_AMOUNT_18DP = 10 ether;
if (grossUsdcEstimate < MIN_USDC_AMOUNT_18DP) revert BelowMinAmount();

// Option B: normalize estimate to 6dp before comparing
if (grossUsdcEstimate / 1e12 < MIN_USDC_AMOUNT) revert BelowMinAmount();
```

**Why tests don't catch this:** `DeployHelper` uses mock USDC with 18 decimals (OZ default), so with `exchangeRate = 1e18` the scale mismatch is invisible — `grossUsdcEstimate` and USDC amounts are coincidentally in the same range.

---

## M2 — Direct LT donations to a curve pair can force early graduation and distort LP accounting

**Files:** `src/Bonding.sol:551`, `src/Bonding.sol:762`, `src/Bonding.sol:764`  
**Principle:** #1 (Asset Accounting), #2 (Reserved Balance)

`canGraduate` uses `IPair(pair).assetBalance()` — a raw `balanceOf` — for the USD graduation trigger:

```solidity
uint256 valueUsd = (IPair(pair).assetBalance() * ILeveragedToken(info.ltAddress).exchangeRate()) / 1e18;
return valueUsd >= graduationThresholdUsd;
```

`assetBalance()` includes **any** LT transferred directly to the pair address, not just LT raised via buys through the Router. A third party can donate LT to the pair to cross the graduation threshold without organic buy pressure.

The damage compounds during phase 1. `router.graduate()` also drains `assetBalance()` (raw):

```solidity
ltFromPair = router.graduate(tokenAddress);  // = assetBalance() including donations
tokensForLP = assetReserve == 0 ? 0 : (ltFromPair * tokenReserve) / assetReserve;
```

`assetReserve` from `getReserves()` is the **virtual** reserve that tracks only Router-mediated buys. When `ltFromPair` (donation-inflated) is divided by `assetReserve` (buy-only), `tokensForLP` can exceed `LP_RESERVE` and the cap binds:

```
tokensForLP = LP_RESERVE  (capped)
ltFromPair  = raisedLT + donated  (uncapped, all seeded into HyperSwap)
```

The result: the HyperSwap LP opens with more LT per token than the curve's last price — the zero-gap guarantee is broken, and arbitrageurs immediately profit at the expense of the locked LP.

The attacker irrecoverably loses the donated LT (it ends up in the locked LP), so this is expensive griefing rather than profit-seeking. The cost makes it unlikely but not impossible (e.g. a competing project sabotaging a rival token's graduation price).

**Fix:** Use stored reserves instead of raw balance for both the graduation trigger and `ltFromPair`. The initial virtual LT reserve is derivable from the pair's `k` and `totalSupply`:

```solidity
// In canGraduate — use reserve delta, not raw balance
(, uint256 assetReserve) = IPair(pair).getReserves();
uint256 virtualInitial = IPair(pair).k() / Token(token_).TOTAL_SUPPLY();
uint256 raisedLT = assetReserve - virtualInitial;
uint256 valueUsd = (raisedLT * ILeveragedToken(info.ltAddress).exchangeRate()) / 1e18;

// In _prepareGraduationLiquidity — drain only accounted LT; leave donation surplus in pair
uint256 virtualInitial = IPair(pairAddr).k() / Token(tokenAddress).TOTAL_SUPPLY();
ltFromPair = assetReserve - virtualInitial;  // use reserve delta, not assetBalance()
// Residual donation stays in pair; arbitrageurs correct the imbalance post-grad
```

---

## M3 — Capital-rich attacker can pre-seed HyperSwap pair to halve the protocol's locked LP position

**Files:** `src/Bonding.sol:776-804`  
**Principle:** #19 (Exchange Rate Discrete Jumps and MEV)

Phase 2 graduation reuses an existing HyperSwap pair and mints LP with no minimum-LP-share check:

```solidity
IERC20(tokenAddress).safeTransfer(pair, tokensForLP);
IERC20(lt).safeTransfer(pair, ltFromPair);
liquidity = IUniswapV2Pair(pair).mint(lpLock);
```

The code comment claims the downside of pre-seeding is "bounded by what the front-runner is willing to lock." This is true for dust seeds (negligible impact) but incorrect for coordinated capital-rich attacks. For UniV2, LP minted into an existing pool is:

```text
liquidity = min(amountToken * totalSupply / reserveToken,
                amountLT    * totalSupply / reserveLT)
```

**Attack:** With graduation amounts `tokensForLP = A` and `ltFromPair = B`:

1. Attacker buys a tiny amount of the launched token before graduation triggers.
2. After phase 1 freezes trading, attacker creates the HyperSwap pair, seeds with `1 wei token + B LT`, receives initial LP (`≈ sqrt(B)`).
3. `finalizeGraduation` deposits `A tokens + B LT`; LP minted to `lpLock` ≈ `sqrt(B)` (same as attacker received).
4. Attacker redeems their LP, recovering `≈ B LT + A/2 tokens`. Net gain: `A/2 tokens` for free; LT fully recovered.

The protocol's locked LP covers only half the intended graduation liquidity depth.

**Why this is Medium and not High:** The attacker must deploy `B` LT (~$69K at the production threshold) as working capital upfront. The extracted `A/2 tokens` cannot be exited without severe price impact (the attacker owns ~50% of the thin post-grad pool). The realistic extractable value is substantially less than the nominal graduation amount. The attack is economically marginal and requires capital that ties up $69K for multiple blocks.

**Fix:** Add a minimum LP-share requirement after minting, or seed the pair in the same transaction as phase 1 (locking in the ratio before any front-runner can act):

```solidity
uint256 liquidity = IUniswapV2Pair(pair).mint(lpLock);
// Require protocol receives at least half the expected LP
uint256 totalSupply = IUniswapV2Pair(pair).totalSupply();
if (liquidity * 2 < totalSupply - liquidity) revert InsufficientLPMinted();
```

Alternatively, require `pair.totalSupply() == 0` before seeding and revert (rather than proceeding) if the pair was pre-seeded with non-dust reserves.

---

## L1 — Zap leaves residual allowances after partial LT consumption and redemption

**Files:** `src/Zap.sol:304` (buy leftover refund), `src/Zap.sol:346` (sell LT redemption), `src/Zap.sol:422-429` (curve buy), `src/Router.sol:113-115`, `src/Router.sol:136-142`  
**Principle:** #22 (Least-Privilege Token Allowances)

`Zap._buyOnCurve` approves the curve Router for the full LT amount minted from the user's USDC:

```solidity
IERC20(lt).forceApprove(address(curveRouter), ltAmount);
(tokensOut, amountInUsed) = bonding.buy(ltAmount, tokenAddress, 0, msg.sender);
```

But `Router.buy` can consume less than that amount when the overflow cap binds:

```solidity
if (tokensOut > realBalance) {
    tokensOut = realBalance;
    ...
    amountInUsed = cappedReserveAsset - reserveAsset;
}
IERC20(asset).safeTransferFrom(to, pairAddr, amountInUsed);
```

In that path, the unused approval `ltAmount - amountInUsed` remains from `Zap` to `Router`. The canonical Router is role-gated and non-upgradeable, so this is not directly exploitable by arbitrary users. It still violates least-privilege allowance hygiene: if Router roles are misconfigured, or if future code grants `BONDING_ROLE` to another contract, the stale allowance gives that role-holder a pull capability over any same-LT balance later held by Zap.

The same residual-approval pattern exists around LT redemption:

```solidity
IERC20(lt).forceApprove(lt, ltReceived);           // approves LT contract to spend Zap's LT
uint256 grossUsdc = ILeveragedToken(lt).redeem(address(this), ltReceived, 0);
```

The BounceTech LT's `redeem` burns from `msg.sender` directly (standard ERC20 pattern, confirmed by mock). The approval gives the LT contract itself a standing allowance to spend Zap's LT balance via `transferFrom`. If the LT contract has any user-callable path that invokes `transferFrom(zap, ...)`, this residual allowance is exploitable.

**Fix:** Clear residual allowances after the consuming call. For curve buys, zero the Router allowance after `bonding.buy`, or approve only `amountInUsed` by splitting quote and execution if the design later supports it. For redemption, verify the real LT `redeem` does not use `transferFrom`; if it burns from `msg.sender`, remove the `forceApprove`. If it does use `transferFrom`, zero the residual after the call:
```solidity
IERC20(lt).forceApprove(lt, ltReceived);
uint256 grossUsdc = ILeveragedToken(lt).redeem(address(this), ltReceived, 0);
IERC20(lt).forceApprove(lt, 0); // clear residual
```

---

## L2 — `setHyperswap` does not guard against in-flight `Graduating` tokens

**File:** `src/Bonding.sol:585-594`  
**Principle:** #7 (Multi-Step / Async Flows), #17 (Privileged Action Front-Running)

`setHyperswap` updates `hyperswapFactory` and `lpLock` while tokens may already be in `Lifecycle.Graduating`. Their `finalizeGraduation` call will use the **new** `lpLock`, even though phase 1 amounts were cached under the old context. The check `LPLock(newLpLock).isLocker(address(this))` prevents immediate bricking, but if the new `LPLock` has different validation semantics, mid-graduation tokens could be affected.

There is also a privileged-action front-running angle: `finalizeGraduation` is permissionless. If the owner submits `setHyperswap(newFactory, newLpLock)` to migrate away from an old venue/lock, anyone can observe the tx and front-run `finalizeGraduation(token)` for already-`Graduating` tokens. Those tokens permanently seed and lock LP using the old config before the owner update lands.

**Fix:** Either document that `setHyperswap` must only be called when no tokens are in `Graduating` state, or add a guard:
```solidity
// (requires tracking a graduatingCount counter)
if (graduatingCount > 0) revert TokensCurrentlyGraduating();
```

Low impact in practice — the `Graduating` window is typically seconds to a few minutes.

---

## L3 — Router reserve updates do not reconcile actual token balance deltas

**Files:** `src/Router.sol:93-94`, `src/Router.sol:115-118`, `src/Router.sol:161-167`, `src/Pair.sol:68-80`  
**Principle:** #1 (Asset Accounting)

The Router updates `Pair` reserves from the nominal input amounts passed into `swap`, not from the actual ERC20 balance deltas observed after transfer:

```solidity
IERC20(asset).safeTransferFrom(to, pairAddr, amountInUsed);
IPair(pairAddr).swap(0, tokensOut, amountInUsed, 0);
```

`Pair.swap` then trusts `assetIn` / `tokenIn` directly:

```solidity
uint256 newAssetReserve = (_pool.assetReserve + assetIn) - assetOut;
_pool.assetReserve = newAssetReserve;
```

This is correct for the protocol's own launched `Token` contract and for standard BounceTech LTs, because both are expected to be exact-transfer ERC20s. It is not robust if a non-standard LT is ever accepted: fee-on-transfer, rebasing, callback-based, or otherwise non-exact tokens can make stored reserves diverge from actual balances in the same transaction.

**Note: this is a corollary of H1.** An LT allowlist fully closes the realistic attack surface — only non-standard LTs (fee-on-transfer, rebasing) cause reserve drift, and those are excluded by H1's fix. L3 is worth noting for defense-in-depth but does not need an independent fix if H1 is addressed.

**Fix:** Prefer the H1 fix: only allow known exact-transfer BounceTech LT addresses. For defense in depth, `Router.buy`, `Router.sell`, and `addInitialLiquidity` can also measure pair balances before/after transfers and pass the observed delta into `Pair.swap` / `Pair.mint`, reverting if the delta differs from the expected amount.

---

## L4 — Cross-contract allowlists and roles can become stale after dependent setters validate them

**Files:** `src/Zap.sol:498-526`, `src/Bonding.sol:585-636`, `src/FeeVault.sol:109-123`, `src/FeeVault.sol:172-176`, `src/LPLock.sol:50-67`, `src/Factory.sol:38-41`, `src/Router.sol:83-95`, `src/Router.sol:104-118`, `src/Router.sol:149-168`, `src/Router.sol:186-191`  
**Principle:** #10 (Admin Parameter Bounds and Cross-Setter Invariants), #21 (Stale References)

`Zap.setBonding` validates that the Zap is currently allowlisted as a router on the new Bonding contract:

```solidity
if (!Bonding(bonding_).isRouter(address(this))) revert BondingNotConfigured();
```

`Zap.setFeeVault` validates that the new vault has already allowlisted the Zap as a depositor:

```solidity
if (!FeeVault(feeVault_).isDepositor(address(this))) revert VaultNotConfigured();
```

`Bonding.setHyperswap` similarly validates that the new `LPLock` has allowlisted the Bonding contract:

```solidity
if (!LPLock(newLpLock).isLocker(address(this))) revert LpLockNotConfigured();
```

Those checks are good, but each invariant is only checked at the consuming setter. The other side can later revoke the authorization:

```solidity
// Bonding
_routers.remove(router_);

// FeeVault
_depositors.remove(depositor);

// LPLock
isLocker[locker] = authorized;
```

After revocation, `Zap` can still point at the same `Bonding`, but every buy/sell/create through that Zap reverts at `Bonding.onlyRouter`. `Zap` can also still point at the same `FeeVault`, but every fee-bearing buy/sell reverts in `FeeVault.accrue`. Likewise, `Bonding` can still point at the same `LPLock`, but `finalizeGraduation` reverts in `recordLock`, leaving affected tokens in `Graduating` until the admin restores authorization.

The same stale-capability pattern exists for the deploy-time `BONDING_ROLE` grants on `Factory` and `Router`. `Bonding` stores their addresses and calls `Factory.createPair`, `Router.addInitialLiquidity`, `Router.buy`, `Router.sell`, and `Router.graduate` assuming those roles remain valid. If the Factory or Router admin revokes `BONDING_ROLE` from `Bonding`, launches, curve trades, or graduation revert even though `Bonding.factory()` / `Bonding.router()` still point to the same contracts.

This is low severity because only admins can create the condition and recovery is straightforward: re-add the Zap depositor or re-authorize Bonding as locker. It is still a cross-setter invariant worth documenting because operationally it can brick trading or graduation despite the original setter validation passing.

**Fix:** Prefer one of:

1. Treat these as operational runbook invariants and document that active Zap/Bonding/Factory/Router authorizations must not be removed before switching consumers away.
2. Add consumer-side emergency setters/checks and monitoring that alert if `bonding.isRouter(zap)`, `feeVault.isDepositor(zap)`, `lpLock.isLocker(bonding)`, `factory.hasRole(BONDING_ROLE, bonding)`, or `router.hasRole(BONDING_ROLE, bonding)` becomes false.
3. If ownership stays unified, consider making revocation of the currently configured consumer a two-step operation that first requires updating the consumer contract.

---

## L5 — Deploy script activates Zap before FeeVault depositor wiring completes

**File:** `script/Deploy.s.sol:85-90`  
**Principle:** #12 (Deployment and Configuration Invariants)

The deploy script performs the final wiring in this order:

```solidity
factory.setRouter(address(router));
factory.grantRole(factory.BONDING_ROLE(), bondingProxy);
router.grantRole(router.BONDING_ROLE(), bondingProxy);
LPLock(lpLockProxy).setLocker(bondingProxy, true);
Bonding(bondingProxy).addRouter(zapProxy);
FeeVault(feeVaultProxy).addDepositor(zapProxy);
```

`Bonding.addRouter(zapProxy)` is the moment Zap becomes able to call `Bonding.launch`, `Bonding.buy`, and `Bonding.sell`. But `FeeVault.addDepositor(zapProxy)` happens one transaction later. In the gap, a public caller can use `Zap.createToken(..., seedUsdcAmount = 0)` to launch a token, because no fee accrual is needed. Fee-bearing buys/sells during the same gap revert when `Zap._accrueFee` reaches `FeeVault.accrue` and the vault rejects the non-depositor.

This is low severity because it requires racing the deployment window, does not let an attacker steal funds, and seeded launches/trades revert atomically. It can still create premature public launches before the deployment is fully configured.

**Fix:** Wire the FeeVault before activating Zap on Bonding:

```solidity
FeeVault(feeVaultProxy).addDepositor(zapProxy);
Bonding(bondingProxy).addRouter(zapProxy);
```

Keep the existing LPLock authorization before Zap activation so graduation cannot be triggered before phase-2 locking is configured.

---

## L6 — Token status views mishandle unknown token addresses

**Files:** `src/Bonding.sol:527-530`, `src/Bonding.sol:551-560`  
**Principle:** #23 (View / Helper Function Robustness)

`Bonding.isTrading` checks only the lifecycle enum:

```solidity
return _tokenInfo[token_].lifecycle == Lifecycle.Curve;
```

For an unknown token, `_tokenInfo[token_]` is an unwritten storage slot and `Lifecycle.Curve` is the enum zero value. So `isTrading(unknown)` returns `true`, even though `buy` and `sell` would both reject the token via their `info.creator == address(0)` existence check.

`canGraduate` has the opposite failure mode. It also treats an unwritten slot as `Lifecycle.Curve`, then calls into the zero pair address:

```solidity
address pair = info.pair; // address(0) for unknown token
if (IPair(pair).tokenBalance() == 0) return true;
```

That external view call can revert or return undecodable empty data, depending on the client/EVM behavior. Off-chain systems that poll status helpers for a stale address, user-supplied address, or partially indexed token can therefore get inconsistent results: `isTrading == true`, but `canGraduate` fails and core trading reverts.

This does not affect core contract safety because state-changing buy/sell paths already perform the creator existence check. It is still an operational robustness issue for frontends, keepers, and monitoring that rely on these helpers.

**Fix:** Make status helpers share the same token-existence guard as core trade paths:

```solidity
if (_tokenInfo[token_].creator == address(0)) return false;
```

Apply this to `isTrading` and `canGraduate`; optionally document that `getTokenInfo` returns the zero struct for unknown tokens.

---

## L7 — Zap hard-codes one global LT mint/redeem minimum for every token

**Files:** `src/Zap.sol:41-46`, `src/Zap.sol:238-246`, `src/Zap.sol:342-343`  
**Principle:** #24 (Granularity of Control / Per-Instance Overrides)

`Zap` uses one hard-coded USDC floor for every buy and sell:

```solidity
uint256 public constant MIN_USDC_AMOUNT = 10e6;
...
if (usdcAmount < MIN_USDC_AMOUNT) revert BelowMinAmount();
```

The comment says this mirrors BounceTech's LT-level mint/redeem minimum. That is currently safe only if every supported LT permanently shares the same `$10` base-asset minimum. If a single LT is deprecated, configured with a different minimum, or upgraded by BounceTech to use a different floor, Zap has no per-LT override:

- If the LT minimum is raised above `$10`, Zap lets smaller buys/sells through and users hit the cryptic LT revert the guard was meant to avoid.
- If the LT minimum is lowered for a distressed/deprecated LT, Zap still blocks small exits for that LT unless the whole Zap is upgraded.
- Any future owner-controlled global minimum would create the Principle #24 tradeoff directly: lowering it to rescue one LT weakens dust protection for every healthy LT.

This is low severity because the documented BounceTech integration currently states a uniform `$10` minimum, and the existing sell-side implementation has a separate decimal bug already captured in M1. The risk appears when the LT set becomes heterogeneous or BounceTech changes parameters per LT.

**Fix:** Store optional per-LT minimum overrides in Zap, falling back to the global default:

```solidity
mapping(address => uint256) public minUsdcOverride;

function _minUsdcFor(address lt) internal view returns (uint256) {
    uint256 overrideValue = minUsdcOverride[lt];
    return overrideValue == 0 ? MIN_USDC_AMOUNT : overrideValue;
}
```

Use the resolved value in both buy and sell pre-checks. If BounceTech exposes a canonical on-chain minimum in future, prefer reading that at use time.

---

## L8 — `finalizeGraduation` updates lifecycle state after external interactions

**File:** `src/Bonding.sol:731-738`  
**Principle:** CEI (Checks-Effects-Interactions)

`finalizeGraduation` is permissionless and performs two external interactions before flipping the lifecycle state:

```solidity
// INTERACTION 1: external call to HyperSwap factory
address hyperPair = _ensureHyperswapPair(tokenAddress, lt);
// INTERACTION 2: safeTransfer token, safeTransfer LT, pair.mint(lpLock)
uint256 liquidity = _seedHyperswapDirect(tokenAddress, lt, hyperPair, p.tokensForLP, p.ltFromPair);

// ← EFFECTS arrive after both interactions
info.lifecycle = Lifecycle.Graduated;
graduatedPair[tokenAddress] = hyperPair;
delete pendingGraduation[tokenAddress];

// INTERACTION 3
LPLock(lpLock).recordLock(tokenAddress, hyperPair, liquidity);
```

During the `pair.mint(lpLock)` call, `isGraduating(token)` still returns `true` and `isGraduated` returns `false`. Any contract that reads Bonding state during a callback triggered by the LP mint (e.g. a monitoring hook, a contract in the `lpLock` mint path) sees a stale, inconsistent lifecycle. `nonReentrant` blocks write-reentrancy but does not prevent read-only reentrancy into Bonding views from within those external calls.

`lifecycle` and `pendingGraduation` have no dependency on `hyperPair` or `liquidity`, so they can be cleared before any external call. `graduatedPair` must follow `_ensureHyperswapPair` since the address isn't known earlier.

**Fix:**
```solidity
function finalizeGraduation(address tokenAddress) external nonReentrant {
    TokenInfo storage info = _tokenInfo[tokenAddress];
    if (info.lifecycle != Lifecycle.Graduating) revert NotGraduating();

    address lt = info.ltAddress;
    PendingGraduation memory p = pendingGraduation[tokenAddress];

    // Effects first — state is consistent before any external call
    info.lifecycle = Lifecycle.Graduated;
    delete pendingGraduation[tokenAddress];

    // Interactions
    address hyperPair = _ensureHyperswapPair(tokenAddress, lt);
    uint256 liquidity = _seedHyperswapDirect(tokenAddress, lt, hyperPair, p.tokensForLP, p.ltFromPair);
    graduatedPair[tokenAddress] = hyperPair;   // depends on hyperPair, so after _ensureHyperswapPair
    LPLock(lpLock).recordLock(tokenAddress, hyperPair, liquidity);

    emit TokenGraduated(tokenAddress, hyperPair, liquidity, p.tokensForLP, p.lpBurned, p.unsoldBurned);
}
```

---

## Principle #1 Coverage Notes — Asset Accounting

Reviewed value-moving flows:

| Flow | Result |
|------|--------|
| Launch / initial liquidity | Solid for the intentional virtual reserve model: full supply minted to `Bonding`, 75% transferred to pair, 25% retained for LP. |
| Curve buy | Solid for exact-transfer LT: LT consumed by pair, tokens sent to Zap/user, reserves updated from computed `amountInUsed`. Overflow cap and refund path are covered. |
| Curve sell | Solid for exact-transfer token/LT: tokens enter pair, LT exits pair, reserves updated after transfer. |
| Buy overflow refund | Solid: unused LT is redeemed to USDC where possible, otherwise transferred back as LT with an event. |
| Fee accrual / claims | Solid: `FeeVault` tracks creator/protocol liabilities and checks USDC balance backs outstanding claims. |
| Graduation phase 1 | Not solid: raw `assetBalance()` is used as accounted raised LT, creating M2. |
| Graduation phase 2 | Mostly solid: cached phase-1 amounts are used verbatim and LP is minted directly. Externally pre-seeded HyperSwap pairs are handled by design, but raw donated LT before phase 1 remains M2. |
| LP lock | Solid for v1: records LP already minted to `LPLock`; no withdrawal path. |

---

## I1 — `canGraduate` USD trigger uses live exchange rate; sells cannot trigger graduation

**File:** `src/Bonding.sol:559-561`

```solidity
uint256 valueUsd = (IPair(pair).assetBalance() * ILeveragedToken(info.ltAddress).exchangeRate()) / 1e18;
return valueUsd >= graduationThresholdUsd;
```

An LT price pump (no trade required) can push a token over `graduationThresholdUsd`. The token stays in `Lifecycle.Curve` until the next buy, since graduation only fires inside `_executeBuy`. Two side-effects:

1. The first buyer after a rate pump pays the triggering buy + phase-1 graduation gas in one tx (expected behavior, but surprising if undocumented).
2. Holders trying to sell while the token sits above threshold cannot trigger graduation — `sell` does not call `canGraduate`.

**Recommendation:** Document that only buys trigger graduation. Consider adding the `canGraduate` check to `sell` if sell-triggered graduation is desirable.

---

## I2 — `Factory.setRouter` is frozen after the first pair; no Router upgrade path

**File:** `src/Factory.sol:64-70`

```solidity
if (pairCount > 0) revert RouterFrozen();
```

Once any pair exists, the Router cannot be changed without deploying a new Factory. A Router bug found post-launch requires full Factory + Router + Bonding redeployment; existing pairs remain on the old Router forever (`Pair.router` is `immutable`). This is an intentional safety constraint but should be explicit in deployment runbooks and incident-response procedures.

---

## I3 — `creatorFeeBps` can be set to 10000 (100%), routing entire fee to creator

**File:** `src/Zap.sol:536`

```solidity
if (buyFeeBps_ > MAX_FEE_BPS || sellFeeBps_ > MAX_FEE_BPS || creatorFeeBps_ > BPS_DENOM) revert InvalidFee();
```

`creatorFeeBps <= BPS_DENOM` permits 100% of the fee going to the token creator (0% to protocol). No cross-setter invariant enforces a minimum protocol share. Verify this is intentional against tokenomics; if a minimum protocol cut is required, add `if (creatorFeeBps_ > MAX_CREATOR_FEE_BPS) revert InvalidFee()`.

---

## I4 — `LPLock` does not track aggregate locked balance per LP token

**File:** `src/LPLock.sol:50-58`  
**Principle:** #2 (Reserved Balance / Internal Liabilities)

`LPLock.recordLock` checks raw LP-token balance but does not reserve it against other locks using the same `lpPair`:

```solidity
if (IERC20(lpPair).balanceOf(address(this)) < amount) revert InsufficientLPBalance();
locks[token] = LockInfo({lpPair: lpPair, amount: amount, lockedAt: block.timestamp});
```

**This scenario cannot occur in v1.** Every launched token is a unique address, so every TOKEN/LT HyperSwap pair is unique — no two graduated tokens can share an `lpPair` address. The double-count is therefore unreachable with the current architecture.

The finding becomes relevant for v2 if: (a) a withdrawal path is added that treats `locks[token].amount` as a spendable claim, or (b) multiple authorized lockers can record different tokens against the same pair. Document this invariant — "one unique LP pair per launched token" — explicitly before shipping any migration or withdrawal functionality:

```solidity
mapping(address => uint256) public totalLockedByPair;

uint256 free = IERC20(lpPair).balanceOf(address(this)) - totalLockedByPair[lpPair];
if (free < amount) revert InsufficientLPBalance();
totalLockedByPair[lpPair] += amount;
```

---

## I5 — `_executeBuy` triggers graduation state change after `router.buy` external call

**File:** `src/Bonding.sol:664-672`  
**Principle:** CEI (Checks-Effects-Interactions)

```solidity
(amountInUsed, tokensOut) = router.buy(amountIn, tokenAddress, tokenHolder); // INTERACTION

emit Trade(...);

if (canGraduate(tokenAddress)) {
    _enterGraduating(tokenAddress);  // EFFECT after interaction
}
```

The graduation state update (`lifecycle = Graduating`) fires after the external `router.buy` call. In practice the risk is low: `_enterGraduating` sets `lifecycle = Graduating` as its very first line, and `Bonding.buy` is guarded by `nonReentrant`. However, the pattern still means any state read on Bonding triggered from within `router.buy` (e.g. a callback from the token or LT contract) sees the pre-graduation lifecycle.

No fix needed for v1 given `nonReentrant` coverage; worth noting if reentrancy guards are ever relaxed or if token/LT contracts with callbacks are introduced.

---

## I6 — `FeeVault.accrue` mutates state before the underfund invariant check

**File:** `src/FeeVault.sol:113-122`  
**Principle:** CEI (Checks-Effects-Interactions)

```solidity
creatorBalance[creator] += creatorAmount;   // EFFECT
totalAccruedCreator += creatorAmount;        // EFFECT
lifetimeCreatorEarned[creator] += creatorAmount; // EFFECT
...
// CHECK arrives after all mutations
if (usdc.balanceOf(address(this)) < totalAccruedCreator + protocolBalance) revert UnderfundedAccrual();
```

State is written before the safety invariant is verified. USDC's `balanceOf` has no callbacks, so there is no reentrancy risk and the EVM rolls back all mutations on revert. Still, canonical CEI places checks before effects. Moving the `balanceOf` check above the increments would make the intent clearer and eliminate any concern if the USDC token is ever replaced with one that has transfer hooks.

**Fix:**
```solidity
// Check first
uint256 expectedBalance = totalAccruedCreator + protocolBalance + creatorAmount + protocolAmount;
if (usdc.balanceOf(address(this)) < expectedBalance) revert UnderfundedAccrual();
// Then mutate
creatorBalance[creator] += creatorAmount;
...
```

---

## Summary

The two-phase graduation design is solid: amounts pinned in phase 1 eliminate price-manipulation attacks on phase 2. `nonReentrant` guards are correctly placed on all user-facing entry points. The `FeeVault` underfund check (`usdc.balanceOf < totalAccruedCreator + protocolBalance`) is effective defense-in-depth. LP lock pattern, vanity address enforcement, and salt-mixing against front-running are all well-implemented.
