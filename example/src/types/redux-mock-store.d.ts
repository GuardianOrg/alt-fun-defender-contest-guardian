/* eslint-disable @typescript-eslint/no-explicit-any */
declare module "redux-mock-store" {
  import { Store, AnyAction, Middleware } from "redux";

  // Mock store interface
  export interface MockStore<
    S = any,
    A extends AnyAction = AnyAction,
  > extends Store<S, A> {
    getActions(): A[];
    clearActions(): void;
    dispatch: ((action: A) => A) & { mock?: any };
  }

  // Factory function that takes middlewares and returns a function to create a store
  export default function configureMockStore<
    S = any,
    A extends AnyAction = AnyAction,
  >(middlewares?: Middleware[]): (initialState?: S) => MockStore<S, A>;
}
