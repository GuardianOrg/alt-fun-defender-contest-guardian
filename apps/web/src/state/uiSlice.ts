import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

import type { RootState } from "./types";
import type { UnderlyingAsset, Leverage } from "../config/constants";
import type { TokenSort } from "../services/tokenService";
import type { Direction, TokenFilter } from "../services/types";

export type { TokenSort } from "../services/tokenService";

/**
 * Optional pair-level filters layered on top of the tab filter (Trending /
 * New / Graduating / Graduated). Every field is independent and `undefined`
 * means "no constraint" — the home-page table renders the union, not the
 * intersection of selected facets. Forwarded straight to the API's
 * `/tokens?underlying=…&leverage=…&direction=…` query params; the server
 * handles the filtering so pagination math stays accurate.
 */
export interface TokenTableFilters {
  underlying?: UnderlyingAsset;
  leverage?: Leverage;
  direction?: Direction;
}

interface UiState {
  searchOpen: boolean;
  earningsOpen: boolean;
  activeFilter: TokenFilter;
  tokenFilters: TokenTableFilters;
  /**
   * Sort axis for the home-page token table. Only meaningful on the
   * TRENDING and GRADUATED tabs (the only two where the Sort dropdown
   * is rendered — see `TableFilters`). `"default"` resolves per-tab:
   * 24h volume desc on TRENDING, `graduatedAt desc` on GRADUATED. The
   * user's override (mcap / change24h) persists across tab switches by
   * design — picking "Mcap" on TRENDING and clicking GRADUATED leaves
   * the rail reading "Market cap" because the intent (sort by mcap,
   * regardless of cohort) still applies. Kept separate from
   * `tokenFilters` because sort is an axis, not a facet, and
   * `clearTokenFilters` should leave it alone.
   */
  tokenSort: TokenSort;
}

const initialState: UiState = {
  searchOpen: false,
  earningsOpen: false,
  activeFilter: "trending",
  tokenFilters: {},
  tokenSort: "default",
};

const uiSlice = createSlice({
  name: "ui",
  initialState,
  reducers: {
    setSearchOpen(state, action: PayloadAction<boolean>) {
      state.searchOpen = action.payload;
    },
    setEarningsOpen(state, action: PayloadAction<boolean>) {
      state.earningsOpen = action.payload;
    },
    setActiveFilter(state, action: PayloadAction<TokenFilter>) {
      state.activeFilter = action.payload;
    },
    setTokenUnderlyingFilter(
      state,
      action: PayloadAction<UnderlyingAsset | undefined>,
    ) {
      if (action.payload === undefined) {
        delete state.tokenFilters.underlying;
      } else {
        state.tokenFilters.underlying = action.payload;
      }
    },
    setTokenLeverageFilter(
      state,
      action: PayloadAction<Leverage | undefined>,
    ) {
      if (action.payload === undefined) {
        delete state.tokenFilters.leverage;
      } else {
        state.tokenFilters.leverage = action.payload;
      }
    },
    setTokenDirectionFilter(
      state,
      action: PayloadAction<Direction | undefined>,
    ) {
      if (action.payload === undefined) {
        delete state.tokenFilters.direction;
      } else {
        state.tokenFilters.direction = action.payload;
      }
    },
    clearTokenFilters(state) {
      // `tokenSort` is deliberately NOT touched here: it's an axis the
      // user picked on the rail (alongside Market / Leverage /
      // Direction), but it's a different concept — "Clear filters"
      // should reset facets, not undo the user's chosen sort order.
      // If we ever want a separate "Reset sort" affordance we can add
      // it; for now, leaving it sticky matches how every other
      // dashboard table on the web handles the distinction.
      state.tokenFilters = {};
    },
    setTokenSort(state, action: PayloadAction<TokenSort>) {
      state.tokenSort = action.payload;
    },
  },
});

export const {
  setSearchOpen,
  setEarningsOpen,
  setActiveFilter,
  setTokenUnderlyingFilter,
  setTokenLeverageFilter,
  setTokenDirectionFilter,
  clearTokenFilters,
  setTokenSort,
} = uiSlice.actions;

export const selectSearchOpen = (state: RootState) => state.ui.searchOpen;
export const selectEarningsOpen = (state: RootState) => state.ui.earningsOpen;
export const selectActiveFilter = (state: RootState) => state.ui.activeFilter;
export const selectTokenFilters = (state: RootState) => state.ui.tokenFilters;
export const selectTokenSort = (state: RootState) => state.ui.tokenSort;

export default uiSlice.reducer;
