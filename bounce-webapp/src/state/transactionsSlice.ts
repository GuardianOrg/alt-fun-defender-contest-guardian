import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

type PendingTrade = {
  type: "mint" | "redeem";
};

type PendingTradesState = {
  pending: Record<string, PendingTrade>;
};

const initialState: PendingTradesState = {
  pending: {},
};

export const transactionsSlice = createSlice({
  name: "transactions",
  initialState,
  reducers: {
    addPendingTrade: (
      state,
      action: PayloadAction<{ txHash: string; type: "mint" | "redeem" }>,
    ) => {
      const { txHash, type } = action.payload;
      state.pending[txHash] = { type };
    },
    removePendingTrade: (state, action: PayloadAction<string>) => {
      delete state.pending[action.payload];
    },
  },
});

export const { addPendingTrade, removePendingTrade } =
  transactionsSlice.actions;

export const selectPendingTrades = (state: {
  transactions: PendingTradesState;
}) => state.transactions.pending;

export default transactionsSlice.reducer;
