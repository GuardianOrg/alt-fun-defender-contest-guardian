import { configureStore, createListenerMiddleware } from "@reduxjs/toolkit";

import uiReducer, { persistTokenViewMode, setTokenViewMode } from "./uiSlice";

const uiPersistenceMiddleware = createListenerMiddleware();

uiPersistenceMiddleware.startListening({
  actionCreator: setTokenViewMode,
  effect: (action) => {
    persistTokenViewMode(action.payload);
  },
});

export const store = configureStore({
  reducer: {
    ui: uiReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().prepend(uiPersistenceMiddleware.middleware),
});
