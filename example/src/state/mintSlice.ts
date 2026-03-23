import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { zeroAddress } from "viem";

import { trackEvent } from "../analytics/ga";
import { TARGET_ASSETS, type TargetAssetType } from "../constants/targetAssets";
import { getLeverageTokenSymbol } from "../utils/getLeverageTokenSymbol.util";

import type { RootState } from "./store";
import type { ChartTimeInterval } from "../constants/chartTimeIntervals";
import type { LeveragedTokenData } from "../types/leverageTokenData";
import type { Address } from "viem";

export type RedeemModalStates = "closed" | "redeem" | "success";
export type RedeemButtonState = "redeem" | "loading" | "tryAgain";
export type StepperStage =
  | "initial"
  | "approvalPending"
  | "approvalError"
  | "mintPending"
  | "mintExecuting"
  | "mintError"
  | "mintSuccess";
type RequiredSelectedFields = Pick<
  LeveragedTokenData,
  "targetAsset" | "targetLeverage" | "isLong"
>;

export type RecievedPnl = {
  profitAmount: number | null;
  profitPercent: number | null;
};

export type SetSelectedPositionPayload = RequiredSelectedFields &
  Partial<LeveragedTokenData>;

export type SharePayload =
  | {
      positionStatus: "open";
      token: LeveragedTokenData;
    }
  | {
      positionStatus: "closed";
      token: Pick<
        LeveragedTokenData,
        "symbol" | "targetAsset" | "targetLeverage" | "isLong"
      >;
      pnl: RecievedPnl;
    };

export interface MintStateType {
  selected: {
    targetAsset: TargetAssetType;
    interval: ChartTimeInterval;
    longOrShort: "long" | "short";
    leverage: number;
    toggleMarkers: boolean;
  };
  pageUi: {
    isTokenDropdownOpen: boolean;
    gridOrListView: "grid" | "list";
  };
  mintModal: {
    pendingTransactionWarning: boolean;
    mintedAmountString: string | null;
    stepperStage: StepperStage;
  };
  redeemModal: {
    leveragedTokenForRedeem: LeveragedTokenData | null;
    redeemModalStage: RedeemModalStates;
    redeemButtonState: RedeemButtonState;
    latestRedeemHash: Address;
    recievedBaseAmount: string | null;
    recievedPnl: RecievedPnl;
    transactionProcessing: boolean;
  };
  shareModal: {
    payload: SharePayload | null;
    isOpen: boolean;
  };
}

const initialState: MintStateType = {
  selected: {
    targetAsset: TARGET_ASSETS[0],
    interval: "1m",
    longOrShort: "long",
    leverage: 5,
    toggleMarkers: true,
  },
  pageUi: {
    isTokenDropdownOpen: false,
    gridOrListView: "list",
  },
  mintModal: {
    pendingTransactionWarning: false,
    mintedAmountString: null,
    stepperStage: "initial",
  },
  redeemModal: {
    leveragedTokenForRedeem: null,
    redeemModalStage: "closed",
    redeemButtonState: "redeem",
    latestRedeemHash: zeroAddress,
    recievedBaseAmount: null,
    recievedPnl: {
      profitAmount: null,
      profitPercent: null,
    },
    transactionProcessing: false,
  },
  shareModal: {
    payload: null,
    isOpen: false,
  },
};

export const mintSlice = createSlice({
  name: "mint",
  initialState,
  reducers: {
    // selected
    setSelectedTargetAsset: (state, action: PayloadAction<TargetAssetType>) => {
      state.selected.targetAsset = action.payload;
    },
    setSelectedInterval: (state, action: PayloadAction<ChartTimeInterval>) => {
      state.selected.interval = action.payload;
    },
    setLongOrShort: (state, action: PayloadAction<"long" | "short">) => {
      state.selected.longOrShort = action.payload;
    },
    setLeverage: (state, action: PayloadAction<number>) => {
      state.selected.leverage = action.payload;
    },
    setToggleMarkers: (state, action: PayloadAction<boolean>) => {
      state.selected.toggleMarkers = action.payload;
    },

    // pageUi
    setIsTokenDropdownOpen: (state, action: PayloadAction<boolean>) => {
      state.pageUi.isTokenDropdownOpen = action.payload;
    },
    setGridOrListView: (state, action: PayloadAction<"grid" | "list">) => {
      state.pageUi.gridOrListView = action.payload;
    },

    // mintModal
    setPendingTransactionWarning: (state, action: PayloadAction<boolean>) => {
      state.mintModal.pendingTransactionWarning = action.payload;
    },
    setMintedAmountBigInt: (state, action: PayloadAction<bigint | null>) => {
      state.mintModal.mintedAmountString = action.payload?.toString() || null;
    },
    setStepperStage: (state, action: PayloadAction<StepperStage>) => {
      state.mintModal.stepperStage = action.payload;
    },
    setStepperError: (state) => {
      state.mintModal.stepperStage = state.mintModal.stepperStage.startsWith(
        "approval",
      )
        ? "approvalError"
        : "mintError";
    },

    // redeemModal
    setRedeemModalStage: (state, action: PayloadAction<RedeemModalStates>) => {
      state.redeemModal.redeemModalStage = action.payload;
      if (action.payload === "redeem") {
        state.redeemModal.redeemButtonState = "redeem";
      }
    },
    setRedeemButtonState: (
      state,
      action: PayloadAction<"redeem" | "loading" | "tryAgain">,
    ) => {
      state.redeemModal.redeemButtonState = action.payload;
    },
    setLatestRedeemHash: (state, action: PayloadAction<Address>) => {
      state.redeemModal.latestRedeemHash = action.payload;
    },
    setRecievedBaseAmount: (state, action: PayloadAction<bigint | null>) => {
      state.redeemModal.recievedBaseAmount = action.payload?.toString() || null;
    },
    setRecievedPnl: (state, action: PayloadAction<RecievedPnl>) => {
      state.redeemModal.recievedPnl = action.payload;
    },
    setTransactionProcessing: (state, action: PayloadAction<boolean>) => {
      state.redeemModal.transactionProcessing = action.payload;
    },

    // shareModal
    setShareModalPayload: (
      state,
      action: PayloadAction<SharePayload | null>,
    ) => {
      state.shareModal.payload = action.payload;
    },
    openShareModal: (state, action: PayloadAction<SharePayload>) => {
      state.shareModal.isOpen = true;
      state.shareModal.payload = action.payload;
    },
    closeShareModal: (state) => {
      state.shareModal.isOpen = false;
      state.shareModal.payload = null;
    },

    // custom setters

    setSelectedPosition: (
      state,
      action: PayloadAction<SetSelectedPositionPayload>,
    ) => {
      state.selected.targetAsset = TARGET_ASSETS.find(
        (token) => token.symbol === action.payload.targetAsset,
      ) as TargetAssetType;
      state.selected.leverage = action.payload?.targetLeverage;
      state.selected.longOrShort = action.payload.isLong ? "long" : "short";
    },
    setOpenRedeemModal: (state, action: PayloadAction<LeveragedTokenData>) => {
      state.redeemModal.transactionProcessing = false;
      state.redeemModal.leveragedTokenForRedeem = action.payload;
      state.redeemModal.redeemModalStage = "redeem";
      state.redeemModal.redeemButtonState = "redeem";
      trackEvent("redeem_action", {
        label: "redeem_modal_opened",
      });
    },
  },
});

export const {
  setSelectedTargetAsset,
  setSelectedInterval,
  setLongOrShort,
  setLeverage,
  setToggleMarkers,
  setIsTokenDropdownOpen,
  setGridOrListView,
  setPendingTransactionWarning,
  setMintedAmountBigInt,
  setStepperStage,
  setStepperError,
  setRedeemModalStage,
  setRedeemButtonState,
  setLatestRedeemHash,
  setRecievedBaseAmount,
  setRecievedPnl,
  setTransactionProcessing,
  setShareModalPayload,
  openShareModal,
  closeShareModal,
  setSelectedPosition,
  setOpenRedeemModal,
} = mintSlice.actions;

export const selectSelectedTargetAsset = (state: RootState) =>
  state.mint.selected.targetAsset;
export const selectSelectedInterval = (state: RootState) =>
  state.mint.selected.interval;
export const selectLongOrShort = (state: RootState) =>
  state.mint.selected.longOrShort;
export const selectLeverage = (state: RootState) =>
  state.mint.selected.leverage;
export const selectToggleMarkers = (state: RootState) =>
  state.mint.selected.toggleMarkers;

export const selectIsTokenDropdownOpen = (state: RootState) =>
  state.mint.pageUi.isTokenDropdownOpen;
export const selectGridOrListView = (state: RootState) =>
  state.mint.pageUi.gridOrListView;

export const selectPendingTransactionWarning = (state: RootState) =>
  state.mint.mintModal.pendingTransactionWarning;
export const selectMintedAmountBigInt = (state: RootState) =>
  state.mint.mintModal.mintedAmountString
    ? BigInt(state.mint.mintModal.mintedAmountString)
    : null;
export const selectStepperStage = (state: RootState) =>
  state.mint.mintModal.stepperStage;

export const selectLeveragedTokenForRedeem = (state: RootState) =>
  state.mint.redeemModal.leveragedTokenForRedeem;
export const selectRedeemModalStage = (state: RootState) =>
  state.mint.redeemModal.redeemModalStage;
export const selectRedeemButtonState = (state: RootState) =>
  state.mint.redeemModal.redeemButtonState;
export const selectLatestRedeemHash = (state: RootState) =>
  state.mint.redeemModal.latestRedeemHash;
export const selectRecievedBaseAmount = (state: RootState) =>
  BigInt(state.mint.redeemModal.recievedBaseAmount || 0);
export const selectRecievedPnl = (state: RootState) =>
  state.mint.redeemModal.recievedPnl;
export const selectTransactionProcessing = (state: RootState) =>
  state.mint.redeemModal.transactionProcessing;

export const selectShareModalPayload = (state: RootState) =>
  state.mint.shareModal.payload;
export const selectShareModalIsOpen = (state: RootState) =>
  state.mint.shareModal.isOpen;

export const selectLeverageTokenSymbol = (state: RootState) => {
  const { targetAsset, leverage, longOrShort } = state.mint.selected;
  return getLeverageTokenSymbol(targetAsset.symbol, leverage, longOrShort);
};

export default mintSlice.reducer;
