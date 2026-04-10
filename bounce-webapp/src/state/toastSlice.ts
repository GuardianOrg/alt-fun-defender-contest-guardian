import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

import type { RootState } from "./store";

export interface ToastState {
  isOpen: boolean;
  variant: "success" | "warning" | "error" | "info";
  content: string | null;
  loadingIcon?: boolean;
  id: string;
}

const initialState: ToastState = {
  isOpen: false,
  variant: "info",
  content: null,
  loadingIcon: false,
  id: "",
};

export const toastSlice = createSlice({
  name: "toast",
  initialState,
  reducers: {
    setToast: (state, action: PayloadAction<ToastState>) => {
      state.isOpen = action.payload.isOpen;
      state.variant = action.payload.variant;
      state.content = action.payload.content;
      state.loadingIcon = action.payload.loadingIcon || false;
      state.id = action.payload.id;
    },
    clearToast: (state) => {
      state.isOpen = false;
      state.content = null;
    },
  },
});

export const { setToast, clearToast } = toastSlice.actions;

export const selectToast = (state: RootState) => state.toast;

export default toastSlice.reducer;
