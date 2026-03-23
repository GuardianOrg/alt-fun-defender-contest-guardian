import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

import type { RootState } from "./store";

export interface DepositState {
  isOpen: boolean;
}

const initialState: DepositState = {
  isOpen: false,
};

export const depositSlice = createSlice({
  name: "deposit",
  initialState,
  reducers: {
    setDepositIsOpen: (state, action: PayloadAction<boolean>) => {
      state.isOpen = action.payload;
    },
  },
});

export const { setDepositIsOpen } = depositSlice.actions;

export const selectDepositIsOpen = (state: RootState) => state.deposit.isOpen;

export default depositSlice.reducer;
