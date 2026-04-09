import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

import type { RootState } from "./types";
import type { TokenFilter } from "../services/types";

interface UiState {
  searchOpen: boolean;
  earningsOpen: boolean;
  activeFilter: TokenFilter;
}

const initialState: UiState = {
  searchOpen: false,
  earningsOpen: false,
  activeFilter: "trending",
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
  },
});

export const { setSearchOpen, setEarningsOpen, setActiveFilter } =
  uiSlice.actions;

export const selectSearchOpen = (state: RootState) => state.ui.searchOpen;
export const selectEarningsOpen = (state: RootState) => state.ui.earningsOpen;
export const selectActiveFilter = (state: RootState) => state.ui.activeFilter;

export default uiSlice.reducer;
