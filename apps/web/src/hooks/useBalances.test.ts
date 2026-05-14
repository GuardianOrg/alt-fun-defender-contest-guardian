import { describe, expect, it } from "vitest";

import {
  MIN_DISPLAY_VALUE_USD,
  buildHeldTokens,
  mergeApiBalances,
} from "./useBalances";

import type { ChainBalanceResult, RawBalance } from "./useBalances";

/**
 * Base units representing a `1` ERC20 token at 18 decimals. The
 * `balance` field on {@link RawBalance} is a `bigint` mirroring the
 * on-chain representation read by viem's multicall (`balanceOf`
 * returns base units), so every test that wants a "round" amount
 * scales this constant rather than hand-rolling a `10n ** 18n`
 * literal at the call site.
 */
const ONE_TOKEN_18DEC = 10n ** 18n;

/**
 * Build a {@link RawBalance} with sane defaults, layering caller-supplied
 * overrides on top. Mirrors the test-data factories elsewhere in the
 * codebase ({@link buildTokenMarketStats}'s tests, for example) so a
 * test that cares about a single field — `balance`, `isHidden`, etc. —
 * can stay focused on that field instead of restating every required
 * key.
 */
function makeBalance(overrides: Partial<RawBalance>): RawBalance {
  return {
    address: "0x0000000000000000000000000000000000000001",
    name: "Test Token",
    ticker: "TEST",
    ltPair: "HYPE",
    leverage: 2,
    balance: ONE_TOKEN_18DEC,
    imageUrl: "",
    isHidden: false,
    ...overrides,
  };
}

/**
 * Stand-in for `useMarketData().getTokenMarketData` that always reports a
 * cache miss. Models the realistic "market-data payload hasn't landed yet"
 * window — the helper still produces a {@link HeldToken} row, just with a
 * `null` `change24h` that `formatPercentOrDash` collapses to `—` downstream.
 */
const noMarketData = () => undefined;

describe("buildHeldTokens", () => {
  // The regression this test guards: while the prices query is in flight
  // (and `getPrice` returns `0`), `valueUsd` collapses to `0` for every
  // row. The filter MUST reject those rows so the panel skeleton can do
  // its job; the previous implementation gated the filter on a "prices
  // loading" flag, which let every dust + non-dust row through with a
  // `$0` value and a `—` 24h change, then snapped them back to "No
  // positions yet" the instant prices landed.
  it("returns an empty list when prices are not yet loaded", () => {
    const balances = [
      makeBalance({ address: "0xaaaa", balance: ONE_TOKEN_18DEC * 100n }),
      makeBalance({ address: "0xbbbb", balance: ONE_TOKEN_18DEC * 10n }),
      makeBalance({ address: "0xcccc", balance: ONE_TOKEN_18DEC }),
    ];

    const getPriceZero = () => 0;
    expect(buildHeldTokens(balances, getPriceZero, noMarketData)).toEqual([]);
  });

  // Dust holdings are the user-facing manifestation of the bug: a token
  // the user has fully sold often leaves a sub-cent residue from a
  // rounding artefact. The dust threshold filters those out so the
  // "MY POSITIONS" panel doesn't surface a token the user no longer
  // meaningfully holds.
  it("excludes dust positions whose USD value falls below the threshold", () => {
    const balances = [
      makeBalance({
        address: "0xreal",
        balance: ONE_TOKEN_18DEC * 1_000n,
      }),
      makeBalance({
        address: "0xdust",
        balance: ONE_TOKEN_18DEC / 1_000_000n,
      }),
    ];

    const getPrice = (addr: string) => (addr === "0xreal" ? 1 : 1);
    const result = buildHeldTokens(balances, getPrice, noMarketData);

    expect(result).toHaveLength(1);
    expect(result[0]?.address).toBe("0xreal");
  });

  // Positions exactly at the threshold are included. The boundary is
  // documented as `>=`, so a `$0.10` position renders rather than
  // silently disappearing alongside true dust.
  it("includes a position whose value lands exactly at the threshold", () => {
    const balances = [
      makeBalance({
        address: "0xedge",
        balance: ONE_TOKEN_18DEC,
      }),
    ];

    const getPrice = () => MIN_DISPLAY_VALUE_USD;
    const result = buildHeldTokens(balances, getPrice, noMarketData);

    expect(result).toHaveLength(1);
    expect(result[0]?.valueUsd).toBeCloseTo(MIN_DISPLAY_VALUE_USD, 10);
  });

  // Market-data join is best-effort: a held position whose market entry
  // is missing (e.g. the `/market-data` payload hasn't refreshed for the
  // newest token yet) must still render — the row carries `change24h:
  // null` and `formatPercentOrDash` collapses that to a single dash.
  it("renders a row with null change24h when the market-data entry is missing", () => {
    const balances = [
      makeBalance({
        address: "0xunknown",
        balance: ONE_TOKEN_18DEC * 10n,
      }),
    ];

    const result = buildHeldTokens(balances, () => 5, noMarketData);

    expect(result).toHaveLength(1);
    expect(result[0]?.change24h).toBeNull();
  });

  // Hidden positions still belong to the holder (issue #712): they need
  // to surface on the panel so the user can sell them out, with the
  // `isHidden` flag preserved end-to-end so the row can render the
  // policy-violation marker downstream.
  it("propagates the isHidden flag from the raw balance", () => {
    const balances = [
      makeBalance({
        address: "0xhidden",
        balance: ONE_TOKEN_18DEC * 10n,
        isHidden: true,
      }),
      makeBalance({
        address: "0xvisible",
        balance: ONE_TOKEN_18DEC * 10n,
        isHidden: false,
      }),
    ];

    const result = buildHeldTokens(balances, () => 1, noMarketData);

    expect(result.find((t) => t.address === "0xhidden")?.isHidden).toBe(true);
    expect(result.find((t) => t.address === "0xvisible")?.isHidden).toBe(false);
  });

  // Pulls the 24h change off the market-data join when it exists, so
  // the panel's percent column matches the rest of the app's quote
  // surface.
  it("forwards change24h from the market-data lookup when present", () => {
    const balances = [
      makeBalance({
        address: "0xmover",
        balance: ONE_TOKEN_18DEC,
      }),
    ];

    const result = buildHeldTokens(
      balances,
      () => 1,
      () => ({ change24h: 12.5 }),
    );

    expect(result[0]?.change24h).toBe(12.5);
  });
});

describe("mergeApiBalances", () => {
  /**
   * Build a {@link ChainBalanceResult} factory. `resolvedAddresses` is
   * built from `balances` plus an optional `extraResolved` set so a test
   * can model the "chain successfully returned `0`" case (token resolved
   * but not in `balances`) without hand-rolling the lowercase address
   * normalisation in every assertion.
   */
  const chainResult = (
    balances: RawBalance[],
    extraResolved: string[] = [],
  ): ChainBalanceResult => ({
    balances,
    resolvedAddresses: new Set([
      ...balances.map((b) => b.address.toLowerCase()),
      ...extraResolved.map((a) => a.toLowerCase()),
    ]),
  });

  // The chain path is authoritative whenever it returned a positive
  // balance. The API row for the same token must NOT shadow it — even
  // if the indexer is briefly stale and reports a different number.
  it("keeps chain balances unchanged when API has no extra rows", () => {
    const onChain = makeBalance({
      address: "0xCHAIN",
      balance: ONE_TOKEN_18DEC * 5n,
    });
    const fromApiSameToken = makeBalance({
      address: "0xCHAIN",
      balance: ONE_TOKEN_18DEC * 99n,
    });

    const result = mergeApiBalances(chainResult([onChain]), [
      fromApiSameToken,
    ]);

    expect(result).toEqual([onChain]);
  });

  // The user-visible regression from issue #881: a freshly-launched
  // token's `balanceOf` call lands as `status: "failure"` inside the
  // multicall (RPC node hadn't propagated the just-deployed contract,
  // chunk-level transient, etc.), the chain skips it via `continue`,
  // and without the API gap-fill the position simply never appears.
  // The merge MUST add API rows for any address the chain didn't
  // resolve.
  it("merges API rows for addresses the chain failed to resolve", () => {
    const oldOnChain = makeBalance({
      address: "0xOLD",
      balance: ONE_TOKEN_18DEC * 10n,
    });
    const newFromApi = makeBalance({
      address: "0xNEW",
      balance: ONE_TOKEN_18DEC * 5n,
    });

    const result = mergeApiBalances(chainResult([oldOnChain]), [newFromApi]);

    expect(result).toHaveLength(2);
    expect(result.map((b) => b.address)).toEqual(["0xOLD", "0xNEW"]);
  });

  // The original gap-fill use case (issue #712): hidden tokens are
  // filtered out of the catalogue, so the chain multicall never even
  // queries them. They appear as un-resolved + present in the API
  // payload — the merge MUST surface them, with the `isHidden` flag
  // preserved end-to-end so the UI can render the policy disclaimer.
  it("merges hidden API rows that the chain never queried", () => {
    const visibleOnChain = makeBalance({
      address: "0xVISIBLE",
      balance: ONE_TOKEN_18DEC,
    });
    const hiddenFromApi = makeBalance({
      address: "0xHIDDEN",
      balance: ONE_TOKEN_18DEC,
      isHidden: true,
    });

    const result = mergeApiBalances(chainResult([visibleOnChain]), [
      hiddenFromApi,
    ]);

    expect(result).toHaveLength(2);
    expect(result.find((b) => b.address === "0xHIDDEN")?.isHidden).toBe(true);
  });

  // The trust-order guarantee that protects against a briefly-stale
  // indexer: when chain successfully returned `0` for a token (user
  // fully sold and the multicall confirmed the empty slot), the address
  // is in `resolvedAddresses` even though it's NOT in `balances`. The
  // merge must NOT re-introduce the token from a stale API row, because
  // doing so would resurrect a sold-out position until the indexer
  // catches up.
  it("does not re-introduce tokens the chain resolved as zero", () => {
    const stillHeld = makeBalance({
      address: "0xKEEP",
      balance: ONE_TOKEN_18DEC,
    });
    const soldOutButStaleInApi = makeBalance({
      address: "0xSOLD",
      balance: ONE_TOKEN_18DEC * 1000n,
    });

    // 0xSOLD is in `resolvedAddresses` (chain probed it and got a
    // successful 0) but not in `balances`. The API still has a stale
    // non-zero row; it must NOT bleed back into the merged set.
    const result = mergeApiBalances(
      chainResult([stillHeld], ["0xSOLD"]),
      [soldOutButStaleInApi],
    );

    expect(result).toEqual([stillHeld]);
  });

  // The `resolvedAddresses` set is documented as lowercased; the merge
  // filter normalises API addresses before comparison so a checksummed
  // API row matches a lowercased resolution and isn't double-counted.
  // Without this normalisation the user would see the same token twice
  // — once from chain, once from the supposedly-deduplicated API merge.
  it("normalises address case when deciding whether the chain resolved a token", () => {
    const onChainChecksummed = makeBalance({
      address: "0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa",
      balance: ONE_TOKEN_18DEC,
    });
    const apiSameTokenLowercased = makeBalance({
      address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      balance: ONE_TOKEN_18DEC * 2n,
    });

    const result = mergeApiBalances(chainResult([onChainChecksummed]), [
      apiSameTokenLowercased,
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]?.address).toBe(
      "0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa",
    );
  });

  // No API rows at all (e.g. a fresh wallet whose Ponder index is
  // empty) is the common idle-state path — the merge should return
  // the chain set as-is without allocating a new array, mirroring the
  // explicit short-circuit in the helper. We assert reference identity
  // to lock in that the queryFn isn't paying for an unnecessary clone
  // on every refetch.
  it("returns the chain balances reference when the API set is empty", () => {
    const chain = chainResult([
      makeBalance({ address: "0xONLY", balance: ONE_TOKEN_18DEC }),
    ]);

    const result = mergeApiBalances(chain, []);

    expect(result).toBe(chain.balances);
  });
});
