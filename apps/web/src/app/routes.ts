export const HOME_ROUTE = "/";
export const TOKEN_ROUTE = "token/:address";
export const CREATE_ROUTE = "create";
export const PROFILE_ROUTE = "profile";

export const tokenPath = (address: string) => `/token/${address}`;
export const CREATE_PATH = `/${CREATE_ROUTE}`;
export const PROFILE_PATH = `/${PROFILE_ROUTE}`;
