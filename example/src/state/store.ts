import { configureStore } from "@reduxjs/toolkit";
import { combineReducers } from "redux";
import { persistReducer, persistStore } from "redux-persist";
import storage from "redux-persist/lib/storage";

import depositReducer from "./depositSlice";
import errorReducer from "./errorSlice";
import { listenerMiddleware } from "./listenerMiddleware";
import mintReducer from "./mintSlice";
import registerReducer from "./registerSlice";
import toastReducer from "./toastSlice";
import transactionsReducer from "./transactionsSlice";

const mintPersistConfig = {
  key: "mint-v2.0.4",
  storage,
  whitelist: ["selected", "pageUi", "mintModal"],
};

const rootReducer = combineReducers({
  register: registerReducer,
  error: errorReducer,
  mint: persistReducer(mintPersistConfig, mintReducer),
  toast: toastReducer,
  deposit: depositReducer,
  transactions: transactionsReducer,
});

export const store = configureStore({
  reducer: rootReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({ serializableCheck: false }).prepend(
      listenerMiddleware.middleware,
    ),
});

export const persistor = persistStore(store);

export type AppDispatch = typeof store.dispatch;
export type RootState = ReturnType<typeof store.getState>;
