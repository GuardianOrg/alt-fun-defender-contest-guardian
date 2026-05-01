export const HOME_ROUTE = "/";
export const TOKEN_ROUTE = "token/:address";
export const CREATE_ROUTE = "create";
// Dev-only review page for the vanity tier visual system. Unlinked from
// the navbar — reach it directly via `/dev/tiers`. Strip the route +
// component once review is complete.
export const DEV_TIERS_ROUTE = "dev/tiers";

export const tokenPath = (address: string) => `/token/${address}`;
export const CREATE_PATH = `/${CREATE_ROUTE}`;
