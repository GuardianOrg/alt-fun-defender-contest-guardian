import { describe, expect, it } from "vitest";

import uiReducer, {
  clearTokenFilters,
  selectTokenFilters,
  selectTokenViewMode,
  setTokenDirectionFilter,
  setTokenLeverageFilter,
  setTokenUnderlyingFilter,
  setTokenViewMode,
} from "./uiSlice";

import type { RootState } from "./types";

const initialState = uiReducer(undefined, { type: "@@INIT" });

describe("uiSlice token filters", () => {
  it("starts with no facets selected", () => {
    expect(initialState.tokenFilters).toEqual({});
  });

  it("sets the underlying facet and clears it with undefined", () => {
    const withUnderlying = uiReducer(
      initialState,
      setTokenUnderlyingFilter("HYPE"),
    );
    expect(withUnderlying.tokenFilters.underlying).toBe("HYPE");

    const cleared = uiReducer(withUnderlying, setTokenUnderlyingFilter(undefined));
    expect(cleared.tokenFilters).toEqual({});
  });

  it("sets the leverage facet and clears it with undefined", () => {
    const withLev = uiReducer(initialState, setTokenLeverageFilter(5));
    expect(withLev.tokenFilters.leverage).toBe(5);

    const cleared = uiReducer(withLev, setTokenLeverageFilter(undefined));
    expect(cleared.tokenFilters.leverage).toBeUndefined();
  });

  it("sets the direction facet and clears it with undefined", () => {
    const withDir = uiReducer(initialState, setTokenDirectionFilter("short"));
    expect(withDir.tokenFilters.direction).toBe("short");

    const cleared = uiReducer(withDir, setTokenDirectionFilter(undefined));
    expect(cleared.tokenFilters.direction).toBeUndefined();
  });

  it("clearTokenFilters wipes every facet at once", () => {
    let state = uiReducer(initialState, setTokenUnderlyingFilter("BTC"));
    state = uiReducer(state, setTokenLeverageFilter(3));
    state = uiReducer(state, setTokenDirectionFilter("long"));
    expect(state.tokenFilters).toEqual({
      underlying: "BTC",
      leverage: 3,
      direction: "long",
    });

    const cleared = uiReducer(state, clearTokenFilters());
    expect(cleared.tokenFilters).toEqual({});
  });

  it("selectTokenFilters reads the active facets from state", () => {
    let state = uiReducer(initialState, setTokenUnderlyingFilter("ETH"));
    state = uiReducer(state, setTokenLeverageFilter(2));

    const root = { ui: state } as unknown as RootState;
    expect(selectTokenFilters(root)).toEqual({
      underlying: "ETH",
      leverage: 2,
    });
  });
});

describe("uiSlice token view mode", () => {
  it("defaults token rows to grid view", () => {
    expect(initialState.tokenViewMode).toBe("grid");
  });

  it("sets and selects the token view mode", () => {
    const state = uiReducer(initialState, setTokenViewMode("list"));
    const root = { ui: state } as unknown as RootState;

    expect(selectTokenViewMode(root)).toBe("list");
  });
});
