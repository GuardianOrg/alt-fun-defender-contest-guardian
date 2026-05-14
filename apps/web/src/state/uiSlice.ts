import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

import type { RootState } from "./types";
import type { UnderlyingAsset, Leverage } from "../config/constants";
import type { Direction, TokenFilter } from "../services/types";

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
}

const initialState: UiState = {
  searchOpen: false,
  earningsOpen: false,
  activeFilter: "trending",
  tokenFilters: {},
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
      state.tokenFilters = {};
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
} = uiSlice.actions;

export const selectSearchOpen = (state: RootState) => state.ui.searchOpen;
export const selectEarningsOpen = (state: RootState) => state.ui.earningsOpen;
export const selectActiveFilter = (state: RootState) => state.ui.activeFilter;
export const selectTokenFilters = (state: RootState) => state.ui.tokenFilters;

export default uiSlice.reducer;
