import { createListenerMiddleware } from "@reduxjs/toolkit";

import {
  setToast,
  clearToast,
  selectToast,
  type ToastState,
} from "./toastSlice";

import type { RootState } from "./store";

export const listenerMiddleware = createListenerMiddleware();

listenerMiddleware.startListening({
  actionCreator: setToast,
  effect: async (action, listenerApi) => {
    const toast: ToastState = action.payload;

    if (toast.variant !== "info") return;

    const toastId = toast.id;

    // wait 60 seconds before showing error message
    await listenerApi.delay(60_000);

    const currentToast = selectToast(listenerApi.getState() as RootState);

    if (
      currentToast.isOpen &&
      currentToast.id === toastId &&
      currentToast.variant === "info"
    ) {
      listenerApi.dispatch(
        setToast({
          isOpen: true,
          variant: "error",
          content:
            "We are unable to detect a successful transaction. Please check your wallet for confirmation. Contact the team on Discord for assistance.",
          loadingIcon: false,
          id: crypto.randomUUID(),
        }),
      );
      // clear error message after 15 seconds
      await listenerApi.delay(15_000);
      listenerApi.dispatch(clearToast());
    }
  },
});

listenerMiddleware.startListening({
  actionCreator: setToast,
  effect: async (action, listenerApi) => {
    const toast: ToastState = action.payload;

    if (toast.variant !== "success") return;

    const toastId = toast.id;

    await listenerApi.delay(5_000);

    const currentToast = selectToast(listenerApi.getState() as RootState);

    if (
      currentToast.isOpen &&
      currentToast.id === toastId &&
      currentToast.variant === "success"
    ) {
      listenerApi.dispatch(clearToast());
    }
  },
});
