import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

import type { RootState } from "./store";

export interface RegisterState {
  inviteCode: string | null;
  signature: string | null;
  hasRegistered: boolean;
}

const initialState: RegisterState = {
  signature: null,
  inviteCode: null,
  hasRegistered: false,
};

export const registerSlice = createSlice({
  name: "register",
  initialState,
  reducers: {
    setSignature: (state, action: PayloadAction<string | null>) => {
      state.signature = action.payload;
    },
    setInviteCode: (state, action: PayloadAction<string | null>) => {
      state.inviteCode = action.payload;
    },
    setHasRegistered: (state, action: PayloadAction<boolean>) => {
      state.hasRegistered = action.payload;
    },
  },
});

export const { setSignature, setInviteCode, setHasRegistered } =
  registerSlice.actions;

export const selectSignature = (state: RootState) => state.register.signature;

export const selectInviteCode = (state: RootState) => state.register.inviteCode;

export const selectHasRegistered = (state: RootState) =>
  state.register.hasRegistered;

export default registerSlice.reducer;
