import { describe, expect, it } from "vitest";

import { MIN_DISPLAY_VALUE_USD, buildHeldTokens } from "./useBalances";

import type { RawBalance } from "./useBalances";

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
