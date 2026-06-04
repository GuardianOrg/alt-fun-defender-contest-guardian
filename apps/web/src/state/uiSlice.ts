import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

import type { RootState } from "./types";
import type { UnderlyingAsset, Leverage } from "../config/constants";
import type { TokenSort } from "../services/tokenService";
import type { Direction, TokenFilter } from "../services/types";

export type { TokenSort } from "../services/tokenService";

export type TokenViewMode = "grid" | "list";

export const TOKEN_VIEW_MODE_STORAGE_KEY = "altfun.tokenViewMode";
const DEFAULT_TOKEN_VIEW_MODE: TokenViewMode = "grid";

const isTokenViewMode = (value: unknown): value is TokenViewMode =>
  value === "grid" || value === "list";

export const readStoredTokenViewMode = (
  storage: Pick<Storage, "getItem"> | undefined = globalThis.window?.localStorage,
): TokenViewMode => {
  try {
    const stored = storage?.getItem(TOKEN_VIEW_MODE_STORAGE_KEY);
    return isTokenViewMode(stored) ? stored : DEFAULT_TOKEN_VIEW_MODE;
  } catch {
    return DEFAULT_TOKEN_VIEW_MODE;
  }
};

export const persistTokenViewMode = (
  mode: TokenViewMode,
  storage: Pick<Storage, "setItem"> | undefined = globalThis.window?.localStorage,
): void => {
  try {
    storage?.setItem(TOKEN_VIEW_MODE_STORAGE_KEY, mode);
  } catch {
    // localStorage can be unavailable in private or restricted browsing contexts.
  }
};

/** Optional pair-level facets layered on top of the lifecycle tab. */
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
  /** Sort axis, kept separate so clearing facets does not reset sort. */
  tokenSort: TokenSort;
  tokenViewMode: TokenViewMode;
}

const initialState: UiState = {
  searchOpen: false,
  earningsOpen: false,
  activeFilter: "trending",
  tokenFilters: {},
  tokenSort: "default",
  tokenViewMode: readStoredTokenViewMode(),
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
    setTokenSort(state, action: PayloadAction<TokenSort>) {
      state.tokenSort = action.payload;
    },
    setTokenViewMode(state, action: PayloadAction<TokenViewMode>) {
      state.tokenViewMode = action.payload;
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
  setTokenViewMode,
} = uiSlice.actions;

export const selectSearchOpen = (state: RootState) => state.ui.searchOpen;
export const selectEarningsOpen = (state: RootState) => state.ui.earningsOpen;
export const selectActiveFilter = (state: RootState) => state.ui.activeFilter;
export const selectTokenFilters = (state: RootState) => state.ui.tokenFilters;
export const selectTokenSort = (state: RootState) => state.ui.tokenSort;
export const selectTokenViewMode = (state: RootState) => state.ui.tokenViewMode;

export default uiSlice.reducer;
