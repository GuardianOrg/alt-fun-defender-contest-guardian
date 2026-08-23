/** Requires `nodejs_compat` in wrangler.json — dropping it fails at runtime; this shim still typechecks. */
declare module "node:async_hooks" {
  export class AsyncLocalStorage<T> {
    run<R>(store: T, callback: () => R): R;
    getStore(): T | undefined;
  }
}
