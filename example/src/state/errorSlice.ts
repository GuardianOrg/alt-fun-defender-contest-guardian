import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

import type { RootState } from "./store";

interface ErrorType {
  message: string;
  details: string | null;
}

export interface ErrorState {
  error: ErrorType | null;
}

const initialState: ErrorState = {
  error: null,
};

export const errorSlice = createSlice({
  name: "error",
  initialState,
  reducers: {
    setError: (state, action: PayloadAction<ErrorType | null>) => {
      state.error = action.payload;
    },
  },
});

export const { setError } = errorSlice.actions;

export const selectError = (state: RootState) => state.error.error;

export default errorSlice.reducer;
